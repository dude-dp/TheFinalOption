import { AIManager } from './ai-manager.js';
import { supabase } from '../database.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { TRADING_SYSTEM_PROMPT } from './prompts.js';

const BENCHMARK_PAYLOAD = `
${TRADING_SYSTEM_PROMPT}

Live Snapshot:
{
  "timestamp": "2026-07-21T10:15:00.000Z",
  "spotPrice": 24550.45,
  "candles": [
    {"timestamp":"2026-07-21T10:11:00.000Z","open":24530,"high":24545,"low":24525,"close":24540,"volume":12400,"buyVolume":6800,"sellVolume":5600,"delta":1200},
    {"timestamp":"2026-07-21T10:12:00.000Z","open":24540,"high":24555,"low":24535,"close":24548,"volume":10200,"buyVolume":5500,"sellVolume":4700,"delta":800},
    {"timestamp":"2026-07-21T10:13:00.000Z","open":24548,"high":24558,"low":24542,"close":24552,"volume":11800,"buyVolume":6200,"sellVolume":5600,"delta":600},
    {"timestamp":"2026-07-21T10:14:00.000Z","open":24552,"high":24560,"low":24545,"close":24555,"volume":13500,"buyVolume":7200,"sellVolume":6300,"delta":900},
    {"timestamp":"2026-07-21T10:15:00.000Z","open":24555,"high":24565,"low":24548,"close":24550,"volume":15420,"buyVolume":8100,"sellVolume":7320,"delta":780}
  ],
  "indicators": {
    "vwap": 24542.30,
    "ema9": 24548.15,
    "ema21": 24535.80,
    "rsi": 58.3,
    "volumeRatio": 1.25
  },
  "optionChain": {
    "atmStrike": 24550,
    "callOI": 4850000,
    "putOI": 5120000,
    "callOIChange": 125000,
    "putOIChange": -80000,
    "callIV": 12.5,
    "putIV": 13.1,
    "callBid": 85.50,
    "callAsk": 86.25,
    "putBid": 78.30,
    "putAsk": 79.10,
    "pcr": 1.056,
    "maxPainStrike": 24500,
    "greeks": {
      "atmCallDelta": 0.52,
      "atmCallTheta": -8.45,
      "atmPutDelta": -0.48,
      "atmPutTheta": -7.90,
      "atmCallGamma": 0.0012,
      "atmCallVega": 12.5
    },
    "nearbyStrikes": [
      {"strike":24300,"callOI":380000,"putOI":720000,"callIV":14.2,"putIV":15.1,"callDelta":0.72,"putDelta":-0.28},
      {"strike":24350,"callOI":450000,"putOI":680000,"callIV":13.8,"putIV":14.5,"callDelta":0.68,"putDelta":-0.32},
      {"strike":24400,"callOI":520000,"putOI":610000,"callIV":13.4,"putIV":14.0,"callDelta":0.63,"putDelta":-0.37},
      {"strike":24450,"callOI":580000,"putOI":540000,"callIV":13.0,"putIV":13.5,"callDelta":0.58,"putDelta":-0.42},
      {"strike":24500,"callOI":680000,"putOI":510000,"callIV":12.8,"putIV":13.3,"callDelta":0.55,"putDelta":-0.45},
      {"strike":24550,"callOI":750000,"putOI":480000,"callIV":12.5,"putIV":13.1,"callDelta":0.52,"putDelta":-0.48},
      {"strike":24600,"callOI":620000,"putOI":450000,"callIV":12.3,"putIV":12.9,"callDelta":0.47,"putDelta":-0.53},
      {"strike":24650,"callOI":540000,"putOI":380000,"callIV":12.1,"putIV":12.7,"callDelta":0.42,"putDelta":-0.58},
      {"strike":24700,"callOI":480000,"putOI":310000,"callIV":11.9,"putIV":12.5,"callDelta":0.37,"putDelta":-0.63},
      {"strike":24750,"callOI":350000,"putOI":260000,"callIV":11.7,"putIV":12.3,"callDelta":0.32,"putDelta":-0.68},
      {"strike":24800,"callOI":280000,"putOI":190000,"callIV":11.5,"putIV":12.1,"callDelta":0.28,"putDelta":-0.72}
    ],
    "isStale": false
  },
  "volatilityState": {
    "velocityMultiplier": 1.8,
    "isHighVolatilityRegime": true,
    "ticksPerSecond": 45,
    "spikeCount": 3
  }
}

Analyze the above market snapshot. Output your decision strictly as a valid JSON object.
`;

export class AIBenchmarker {
  /**
   * Runs the daily evaluation suite against all available Groq models.
   */
  public static async runDailyBenchmark(): Promise<void> {
    logInfo('[BENCHMARK] 🚀 Initiating Nightly AI Model Benchmarking...');

    // 1. Fetch fresh list of all free models from Groq
    await AIManager.fetchAvailableModels();
    const candidates = AIManager.availableModels;

    if (candidates.length === 0) {
      logError('[BENCHMARK] ❌ No models found during discovery. Aborting benchmark.');
      return;
    }

    logInfo(`[BENCHMARK] Evaluating ${candidates.length} candidate models...`);

    for (const model of candidates) {
      await this.evaluateModel(model.id);
      // Brief pause to avoid hitting aggressive rate limits on Groq during the test loop
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logInfo('[BENCHMARK] ✅ Nightly benchmark complete. Leaderboard updated.');
  }

  private static async evaluateModel(modelId: string): Promise<void> {
    const startTime = Date.now();
    let score = 0;
    let isValidJson = false;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
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
