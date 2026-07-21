import { AIModel, AIResponse, TradingDecision } from './types.js';
import { logInfo, logError, logWarn } from '../logger.js';
import { supabase } from '../database.js';

interface CircuitBreakerState {
  failures: number;
  cooldownUntil: number;
}

export class AIManager {
  // Switched to GROQ configurations
  private static apiKey = process.env.GROQ_API_KEY || '';
  private static baseUrl = 'https://api.groq.com/openai/v1';
  public static availableModels: AIModel[] = [];

  // In-memory circuit breaker
  private static circuitBreaker = new Map<string, CircuitBreakerState>();
  private static MAX_FAILURES = 3;
  private static COOLDOWN_MS = 60 * 60 * 1000; // 1 Hour

  /**
   * Task 1.2: Discovery & Filtering
   * Fetches models from Groq and filters for the best reasoning/JSON models
   */
  public static async fetchAvailableModels(): Promise<void> {
    logInfo('[AI-MANAGER] Syncing Groq model leaderboard from Supabase...');
    try {
      if (!supabase) throw new Error('Supabase client not initialized');
      
      const { data, error } = await supabase
        .from('ai_model_health')
        .select('model_id, success_rate, latency_ms')
        .order('success_rate', { ascending: false })
        .order('latency_ms', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        this.availableModels = data.map(dbModel => ({
          id: dbModel.model_id,
          name: dbModel.model_id.split('-')[0] || dbModel.model_id,
          context_length: 8192, 
          pricing: { prompt: 0, completion: 0 } // Groq tier is rate-limit based, cost is 0
        }));
        
        logInfo(`[AI-MANAGER] Loaded ${this.availableModels.length} models. Top Pick: ${this.availableModels[0].id} (Score: ${data[0].success_rate})`);
      } else {
        logWarn('[AI-MANAGER] DB leaderboard is empty. Bootstrapping initial Groq network fetch...');
        
        // Fetch from Groq's OpenAI-compatible models endpoint
        const res = await fetch(`${this.baseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const fetchData = await res.json() as { data: any[] };
        
        // Hardcoded whitelist of the fastest and smartest models on Groq for algorithmic trading
        const topTradingModels = [
          'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'gemma2-9b-it',
          'mixtral-8x7b-32768'
        ];
        
        this.availableModels = fetchData.data
          .filter(model => topTradingModels.includes(model.id))
          .map(model => ({
            id: model.id,
            name: model.id,
            context_length: 8192,
            pricing: { prompt: 0, completion: 0 }
          }));

        logInfo(`[AI-MANAGER] Discovered ${this.availableModels.length} top-tier Groq models.`);
        if (this.availableModels.length > 0) {
            logInfo(`[AI-MANAGER] Top candidate: ${this.availableModels[0].id}`);
        }
      }
    } catch (error: any) {
      logError(`[AI-MANAGER] Failed to sync leaderboard: ${error.message}`);
    }
  }

  public static getHealthyModels(): AIModel[] {
    const now = Date.now();
    return this.availableModels.filter(model => {
      const state = this.circuitBreaker.get(model.id);
      if (state && state.cooldownUntil > now) return false;
      return true;
    });
  }

  public static async askWithFallback(prompt: string, taskType: 'trading' | 'analysis' = 'trading'): Promise<AIResponse & { parsed?: TradingDecision }> {
    const healthyModels = this.getHealthyModels();
    
    if (healthyModels.length === 0) {
      logWarn('[AI-MANAGER] 🚨 ALL MODELS EXHAUSTED OR IN COOLDOWN. Triggering emergency WAIT.');
      return this.generateEmergencyFallback();
    }

    const maxAttempts = healthyModels.length;

    for (let i = 0; i < maxAttempts; i++) {
      const targetModel = healthyModels[i].id;
      const startTime = Date.now();

      try {
        logInfo(`[AI-MANAGER] 🧠 Routing request to: ${targetModel} (Attempt ${i + 1}/${maxAttempts})`);
        
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: targetModel,
            // Pre-append JSON instructions to ensure Groq respects the json_object flag
            messages: [{ role: 'user', content: prompt + "\n\nRespond ONLY with a valid JSON object." }],
            temperature: 0.1,
            response_format: { type: "json_object" } // ENFORCE STRICT JSON OUTPUT
          })
        });

        if (!response.ok) {
           throw new Error(`API Error ${response.status} - ${response.statusText}`);
        }

        const result = await response.json() as any;
        const latency = Date.now() - startTime;
        const rawContent = result.choices[0].message.content;

        const parsedDecision = this.parseTradingDecision(rawContent);

        this.updateModelHealth(targetModel, latency, true, true);
        this.resetCircuitBreaker(targetModel);

        return {
          content: rawContent,
          modelUsed: targetModel,
          latencyMs: latency,
          parsed: parsedDecision
        };

      } catch (error: any) {
        logWarn(`[AI-MANAGER] ⚠️ Model ${targetModel} failed: ${error.message}`);
        
        const latency = Date.now() - startTime;
        const isParseError = error.message.includes('Invalid action') || error.message.includes('JSON');
        
        this.updateModelHealth(targetModel, latency, false, !isParseError);
        this.recordFailure(targetModel);
      }
    }

    logError('[AI-MANAGER] ❌ All fallback attempts failed. Emitting emergency WAIT.');
    return this.generateEmergencyFallback();
  }

  public static async askSpecificModel(prompt: string, targetModel: string): Promise<AIResponse & { parsed?: TradingDecision }> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: prompt + "\n\nRespond ONLY with a valid JSON object." }],
          temperature: 0.1,
          response_format: { type: "json_object" } // ENFORCE STRICT JSON OUTPUT
        })
      });

      if (!response.ok) throw new Error(`API Error ${response.status}`);

      const result = await response.json() as any;
      const latency = Date.now() - startTime;
      const rawContent = result.choices[0].message.content;

      const parsedDecision = this.parseTradingDecision(rawContent);
      this.updateModelHealth(targetModel, latency, true, true);

      return {
        content: rawContent,
        modelUsed: targetModel,
        latencyMs: latency,
        parsed: parsedDecision
      };

    } catch (error: any) {
      const latency = Date.now() - startTime;
      const isParseError = error.message.includes('Invalid action') || error.message.includes('JSON');
      
      this.updateModelHealth(targetModel, latency, false, !isParseError);
      this.recordFailure(targetModel);

      return {
        content: '',
        modelUsed: targetModel,
        latencyMs: latency,
        error: error.message
      };
    }
  }

  // ==========================================
  // CIRCUIT BREAKER & HEALTH TELEMETRY
  // ==========================================

  private static recordFailure(modelId: string) {
    const state = this.circuitBreaker.get(modelId) || { failures: 0, cooldownUntil: 0 };
    state.failures += 1;
    
    if (state.failures >= this.MAX_FAILURES) {
      state.cooldownUntil = Date.now() + this.COOLDOWN_MS;
      logWarn(`[AI-MANAGER] 🛑 Model ${modelId} hit max failures. Placed in 1-hour cooldown.`);
    }
    
    this.circuitBreaker.set(modelId, state);
  }

  private static resetCircuitBreaker(modelId: string) {
    this.circuitBreaker.delete(modelId);
  }

  private static async updateModelHealth(modelId: string, latency: number, isSuccess: boolean, isValidJson: boolean) {
    setImmediate(async () => {
      try {
        if (!supabase) return;
        const { data, error } = await supabase.rpc('update_ai_health', {
          p_model_id: modelId,
          p_latency: latency,
          p_is_success: isSuccess,
          p_is_valid_json: isValidJson
        });

        if (error) {
           logError(`[AI-MANAGER] DB Health Update failed: ${error.message}`);
        }
      } catch (e) {}
    });
  }

  private static generateEmergencyFallback(): AIResponse & { parsed: TradingDecision } {
    const fallbackDecision: TradingDecision = {
      action: 'WAIT',
      confidence: 0,
      reasoning: 'SYSTEM EMERGENCY: AI Matrix Offline. Halting execution.',
      risk_level: 'HIGH'
    };

    return {
      content: JSON.stringify(fallbackDecision),
      modelUsed: 'NONE',
      latencyMs: 0,
      parsed: fallbackDecision,
      error: 'All models failed.'
    };
  }

  public static parseTradingDecision(rawContent: string): TradingDecision {
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!['BUY_CE', 'BUY_PE', 'WAIT'].includes(parsed.action)) {
        throw new Error(`Invalid action returned: ${parsed.action}`);
      }
      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 100) {
        throw new Error(`Invalid confidence score: ${parsed.confidence}`);
      }

      return parsed as TradingDecision;
      
    } catch (error: any) {
      logError(`[AI-MANAGER] Failed to parse JSON payload: ${error.message}. Raw output: ${rawContent}`);
      
      return {
        action: 'WAIT',
        confidence: 0,
        reasoning: `Parse Error: ${error.message}`,
        risk_level: 'HIGH'
      };
    }
  }
}
