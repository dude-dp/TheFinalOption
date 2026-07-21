import { AIManager } from './ai-manager.js';
import { supabase } from '../database.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { TRADING_SYSTEM_PROMPT } from './prompts.js';

const BENCHMARK_PAYLOAD = `
${TRADING_SYSTEM_PROMPT}

=== CURRENT NIFTY MARKET TELEMETRY (BENCHMARK TEST) ===
Timestamp: 2026-07-21T10:15:00.000Z
Spot Price: 24550.45
Candle Volume: 15420
Institutional Order Flow (Delta): 3500
Velocity/TPS Spike Multiplier: 1.8 (High Volatility: true)

Analyze the above constraints. Do institutional delta and velocity imply an immediate breakout? Output your decision strictly in JSON.
`;

export class AIBenchmarker {
  /**
   * Runs the daily evaluation suite against all available OpenRouter free models.
   */
  public static async runDailyBenchmark(): Promise<void> {
    logInfo('[BENCHMARK] 🚀 Initiating Nightly AI Model Benchmarking...');

    // 1. Fetch fresh list of all free models from OpenRouter
    await AIManager.fetchAvailableModels();
    const candidates = AIManager.availableModels;

    if (candidates.length === 0) {
      logError('[BENCHMARK] ❌ No models found during discovery. Aborting benchmark.');
      return;
    }

    logInfo(`[BENCHMARK] Evaluating ${candidates.length} candidate models...`);

    for (const model of candidates) {
      await this.evaluateModel(model.id);
      // Brief pause to avoid hitting aggressive rate limits on OpenRouter during the test loop
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logInfo('[BENCHMARK] ✅ Nightly benchmark complete. Leaderboard updated.');
  }

  private static async evaluateModel(modelId: string): Promise<void> {
    const startTime = Date.now();
    let score = 0;
    let isValidJson = false;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://staq.shop',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: BENCHMARK_PAYLOAD }],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json() as any;
      const rawContent = result.choices[0].message.content;

      // --- SCORING LOGIC ---
      
      // 1. JSON Correctness & Instruction Following (40 Points)
      const parsed = AIManager.parseTradingDecision(rawContent);
      if (parsed.action !== 'WAIT' || !rawContent.includes('Parse Error')) {
        isValidJson = true;
        score += 40;
      }

      // 2. Latency (20 Points)
      if (latency < 800) score += 20;
      else if (latency < 1500) score += 15;
      else if (latency < 3000) score += 10;
      else if (latency < 5000) score += 5;

      // 3. Reasoning Quality / Constraint Adherence (40 Points)
      if (isValidJson) {
        if (parsed.reasoning && parsed.reasoning.length > 20) {
          score += 20; // Provided a solid explanation
        }
        if (['LOW', 'MEDIUM', 'HIGH'].includes(parsed.risk_level)) {
          score += 20; // Followed exact enum constraints
        }
      }

      logInfo(`[BENCHMARK] ${modelId} | Latency: ${latency}ms | Score: ${score}/100`);

      // Update DB with the benchmark results
      if (supabase) {
        await supabase.from('ai_model_health').upsert({
          model_id: modelId,
          latency_ms: latency,
          json_validity: isValidJson ? 100 : 0,
          success_rate: score, // Mapping success_rate to the benchmark score for ranking
          last_used: new Date().toISOString()
        }, { onConflict: 'model_id' });
      }

    } catch (error: any) {
      logWarn(`[BENCHMARK] ⚠️ Model ${modelId} failed test: ${error.message}`);
      if (supabase) {
        await supabase.from('ai_model_health').upsert({
          model_id: modelId,
          latency_ms: 9999,
          json_validity: 0,
          success_rate: 0,
          last_used: new Date().toISOString()
        }, { onConflict: 'model_id' });
      }
    }
  }
}
