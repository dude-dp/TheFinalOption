import { OpenRouterModel, AIResponse, TradingDecision } from './types.js';
import { logInfo, logError, logWarn } from '../logger.js';
import { supabase } from '../database.js';

interface CircuitBreakerState {
  failures: number;
  cooldownUntil: number;
}

export class AIManager {
  private static apiKey = process.env.OPENROUTER_API_KEY || '';
  private static baseUrl = 'https://openrouter.ai/api/v1';
  public static availableModels: OpenRouterModel[] = [];

  // In-memory circuit breaker
  private static circuitBreaker = new Map<string, CircuitBreakerState>();
  private static MAX_FAILURES = 3;
  private static COOLDOWN_MS = 60 * 60 * 1000; // 1 Hour

  /**
   * Task 1.2: Discovery & Filtering
   * Fetches models, filters for free pricing, and ensures context length >= 32000
   */
  public static async fetchAvailableModels(): Promise<void> {
    logInfo('[AI-MANAGER] Syncing model leaderboard from Supabase...');
    try {
      if (!supabase) throw new Error('Supabase client not initialized');
      // Fetch the top 10 models sorted by our benchmark score and latency
      const { data, error } = await supabase
        .from('ai_model_health')
        .select('model_id, success_rate, latency_ms')
        .order('success_rate', { ascending: false })
        .order('latency_ms', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        // Map the DB rows back into the OpenRouterModel array structure expected by the engine
        this.availableModels = data.map(dbModel => ({
          id: dbModel.model_id,
          name: dbModel.model_id.split('/')[1] || dbModel.model_id,
          context_length: 32000, // Assumed valid since they passed Phase 1 discovery
          pricing: { prompt: 0, completion: 0 }
        }));
        
        logInfo(`[AI-MANAGER] Loaded ${this.availableModels.length} models. Top Pick: ${this.availableModels[0].id} (Score: ${data[0].success_rate})`);
      } else {
        logWarn('[AI-MANAGER] DB leaderboard is empty. Bootstrapping initial OpenRouter network fetch...');
        // Fallback to the original OpenRouter fetch logic if DB is empty
        const res = await fetch(`${this.baseUrl}/models`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const fetchData = await res.json() as { data: OpenRouterModel[] };
        
        this.availableModels = fetchData.data.filter(model => {
          const isFree = Number(model.pricing.prompt) === 0 && Number(model.pricing.completion) === 0;
          const hasContext = model.context_length >= 32000;
          // Avoid known deprecated or highly experimental tags if necessary
          const isStable = !model.name.toLowerCase().includes('deprecated');
          
          return isFree && hasContext && isStable;
        });

        logInfo(`[AI-MANAGER] Discovered ${this.availableModels.length} viable free models.`);
        if (this.availableModels.length > 0) {
            logInfo(`[AI-MANAGER] Top candidate: ${this.availableModels[0].id}`);
        }
      }
    } catch (error: any) {
      logError(`[AI-MANAGER] Failed to sync leaderboard: ${error.message}`);
    }
  }

  /**
   * Safe getter that excludes models currently in cooldown.
   */
  public static getHealthyModels(): OpenRouterModel[] {
    const now = Date.now();
    return this.availableModels.filter(model => {
      const state = this.circuitBreaker.get(model.id);
      if (state && state.cooldownUntil > now) return false;
      return true;
    });
  }

  /**
   * Phase 2: The Retry Matrix
   * Attempts to get a valid decision, falling back to the next model on failure.
   */
  public static async askWithFallback(prompt: string, taskType: 'trading' | 'analysis' = 'trading'): Promise<AIResponse & { parsed?: TradingDecision }> {
    const healthyModels = this.getHealthyModels();
    
    if (healthyModels.length === 0) {
      logWarn('[AI-MANAGER] 🚨 ALL MODELS EXHAUSTED OR IN COOLDOWN. Triggering emergency WAIT.');
      return this.generateEmergencyFallback();
    }

    // Try all available healthy models before giving up entirely for this tick
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
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://staq.shop',
            'X-Title': 'NIFTY Scalper Edge',
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
          })
        });

        if (!response.ok) {
           throw new Error(`API Error ${response.status} - ${response.statusText}`);
        }

        const result = await response.json() as any;
        const latency = Date.now() - startTime;
        const rawContent = result.choices[0].message.content;

        // Attempt to parse the schema immediately to verify json_validity
        const parsedDecision = this.parseTradingDecision(rawContent);

        // ✅ Success: Update health, reset failures, and return
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
        
        // ❌ Failure: Update health, increment strikes
        this.updateModelHealth(targetModel, latency, false, !isParseError);
        this.recordFailure(targetModel);
        
        // Loop immediately continues to the next model in the array
      }
    }

    logError('[AI-MANAGER] ❌ All fallback attempts failed. Emitting emergency WAIT.');
    return this.generateEmergencyFallback();
  }

  /**
   * Phase 3 Helper: Bypasses the fallback loop to hit a specific model directly.
   * Used strictly for parallel ensemble execution.
   */
  public static async askSpecificModel(prompt: string, targetModel: string): Promise<AIResponse & { parsed?: TradingDecision }> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://staq.shop',
          'X-Title': 'NIFTY Scalper Edge',
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1
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

  /**
   * Async fire-and-forget to Supabase to keep long-term statistics for the Dashboard
   */
  private static async updateModelHealth(modelId: string, latency: number, isSuccess: boolean, isValidJson: boolean) {
    // Fire asynchronously so it doesn't block the trading loop
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
           // Fallback if RPC isn't created yet: Simple UPSERT logic or manual fetch/update
           logError(`[AI-MANAGER] DB Health Update failed: ${error.message}`);
        }
      } catch (e) {
         // Silently catch to prevent daemon disruption
      }
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

  /**
   * Safely parses the LLM output into the strict TradingDecision schema.
   * Strips markdown backticks if the model hallucinates them.
   */
  public static parseTradingDecision(rawContent: string): TradingDecision {
    try {
      // Extract ONLY the JSON object from raw content to bypass preambles (e.g. "User Safety: safe") and markdown wrappers
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (rawContent.includes("User Safety: safe")) {
          return {
            action: 'WAIT',
            confidence: 0,
            reasoning: 'Model returned safety check without JSON',
            risk_level: 'LOW'
          };
        }
        throw new Error("No JSON object found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!['BUY_CE', 'BUY_PE', 'WAIT'].includes(parsed.action)) {
        throw new Error(`Invalid action returned: ${parsed.action}`);
      }
      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 100) {
        throw new Error(`Invalid confidence score: ${parsed.confidence}`);
      }

      return parsed as TradingDecision;
      
    } catch (error: any) {
      logError(`[AI-MANAGER] Failed to parse JSON payload: ${error.message}. Raw output: ${rawContent}`);
      
      // Fail-safe fallback to prevent execution halts
      return {
        action: 'WAIT',
        confidence: 0,
        reasoning: `Parse Error: ${error.message}`,
        risk_level: 'HIGH'
      };
    }
  }
}
