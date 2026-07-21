// ============================================
// Post-Market Telemetry Analyzer
// ============================================
// Run via EC2 cron at 10:15 UTC (15:45 IST) Mon-Fri, AFTER market close:
//
//   15 10 * * 1-5 /usr/bin/node --import tsx/esm /home/ec2-user/TheFinalOption/aws-ec2-daemon/src/post-market-analyzer.ts >> /var/log/tfo-analyzer.log 2>&1
//
// Step 1: Pull today's signal_eval logs from Supabase (aborts + executed trades)
// Step 2: Build a structured LLM prompt with both failure AND success telemetry
// Step 3: Call Groq (llama-3.1-8b-instant) for threshold recommendations
// Step 4: Upsert tuned config to confluence_config table for next-day boot
// ============================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

interface SignalEvalLog {
  signal: string;
  reason: string;
  vwap: number;
  rsi: number;
  ema9: number;
  ema21: number;
  volumeRatio: number;
  velocityMultiplier?: number;
  isHighVolatility?: boolean;
  timestamp: string;
}

interface TradeFillLog {
  signal: string;
  direction: string;
  fillPrice: number;
  lots: number;
  rsi: number;
  ema9: number;
  ema21: number;
  vwap: number;
  trading_mode: string;
  timestamp: string;
}

// ── Step 1: Fetch Today's Telemetry ─────────────────────────────────────────

async function fetchTodaySignalEvals(): Promise<SignalEvalLog[]> {
  const today = todayISO();
  const { data, error } = await supabase
    .from('system_events')
    .select('payload, created_at')
    .eq('event_type', 'signal_eval')
    .gte('created_at', `${today}T00:00:00Z`)
    .lte('created_at', `${today}T23:59:59Z`);

  if (error) throw new Error(`Signal eval fetch failed: ${error.message}`);
  return (data ?? []).map((row: any) => ({ ...row.payload, timestamp: row.created_at }));
}

async function fetchTodayTradeFills(): Promise<TradeFillLog[]> {
  const today = todayISO();
  const { data, error } = await supabase
    .from('system_events')
    .select('payload, created_at')
    .eq('event_type', 'trade_fill')
    .gte('created_at', `${today}T00:00:00Z`)
    .lte('created_at', `${today}T23:59:59Z`);

  if (error) throw new Error(`Trade fill fetch failed: ${error.message}`);
  return (data ?? []).map((row: any) => ({ ...row.payload, timestamp: row.created_at }));
}

// ── Step 2: Build Structured Abort Summary ──────────────────────────────────

interface AbortCategory {
  count: number;
  samples: Array<{ rsi?: number; volumeRatio?: number; reason: string; velocityMultiplier?: number }>;
}

function buildAbortSummary(evals: SignalEvalLog[]): Record<string, AbortCategory> {
  const aborts = evals.filter(e => e.signal === 'NONE' && e.reason);
  const summary: Record<string, AbortCategory> = {};

  for (const abort of aborts) {
    // Categorize by the prefix (e.g. "CE_ABORT", "PE_ABORT", "TIME_LOCK", etc.)
    const category = abort.reason.split(':')[0] || 'UNKNOWN';
    if (!summary[category]) summary[category] = { count: 0, samples: [] };
    summary[category].count++;
    if (summary[category].samples.length < 5) {
      summary[category].samples.push({
        rsi: abort.rsi,
        volumeRatio: abort.volumeRatio,
        reason: abort.reason,
        velocityMultiplier: abort.velocityMultiplier,
      });
    }
  }

  return summary;
}

// ── Step 3: Call Groq ──────────────────────────────────────────────────

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://thefinaloption.com',
      'X-Title': 'TheFinalOption Post-Market Analyzer',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt + "\n\nRespond ONLY with a valid JSON object." }],
      response_format: { type: 'json_object' },
      temperature: 0.2, // low temperature for deterministic financial recommendations
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err.substring(0, 200)}`);
  }

  const json = await res.json() as any;
  return json.choices?.[0]?.message?.content ?? '{}';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const today = todayISO();
  console.log(`[POST-MARKET-ANALYZER] ${new Date().toISOString()} — Starting analysis for ${today}`);

  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set. Aborting analysis.');
  }

  // ── 1. Fetch data ────────────────────────────────────────────────────────
  const [signalEvals, tradeFills] = await Promise.all([
    fetchTodaySignalEvals(),
    fetchTodayTradeFills(),
  ]);

  console.log(`[POST-MARKET-ANALYZER] Fetched ${signalEvals.length} signal evals, ${tradeFills.length} trade fills.`);

  if (signalEvals.length === 0) {
    console.warn('[POST-MARKET-ANALYZER] No signal eval data for today. Skipping LLM analysis.');
    return;
  }

  const abortSummary = buildAbortSummary(signalEvals);
  const confirmedSignals = signalEvals.filter(e => e.signal !== 'NONE');

  // ── 2. Compute RSI distribution from aborts vs confirmed ─────────────────
  const abortedRsiValues = signalEvals
    .filter(e => e.signal === 'NONE' && e.rsi > 0)
    .map(e => e.rsi);

  const confirmedRsiValues = confirmedSignals.map(e => e.rsi).filter(r => r > 0);

  // ── 3. Build LLM prompt ──────────────────────────────────────────────────
  const prompt = `
You are a quantitative trading analyst reviewing an intraday rule-based options system for NIFTY 50 (Indian equity index, NSE).
The system trades 1-minute candles using VWAP, 9/21 EMA, RSI, and volume confluence.

Current static thresholds:
- CE (Bullish) RSI range: [55, 65]
- PE (Bearish) RSI range: [35, 45]
- Volume gate: must exceed 10-period SMA (this threshold is lowered at high TPS multiplier λ)
- Variance expansion: RSI bounds widen by min(15, (λ - 1) × 10) during TPS spikes

=== TODAY'S ABORT SUMMARY ===
Total signal evaluations: ${signalEvals.length}
Confirmed signals (non-NONE): ${confirmedSignals.length}
Abort breakdown by category:
${JSON.stringify(abortSummary, null, 2)}

=== RSI DISTRIBUTION ===
Aborted signals RSI values (sample): ${abortedRsiValues.slice(0, 20).join(', ')}
Aborted RSI mean: ${abortedRsiValues.length > 0 ? (abortedRsiValues.reduce((a, b) => a + b, 0) / abortedRsiValues.length).toFixed(1) : 'N/A'}
Confirmed signals RSI values: ${confirmedRsiValues.join(', ')}
Confirmed RSI mean: ${confirmedRsiValues.length > 0 ? (confirmedRsiValues.reduce((a, b) => a + b, 0) / confirmedRsiValues.length).toFixed(1) : 'N/A'}

=== EXECUTED TRADES TODAY ===
${tradeFills.length > 0 ? JSON.stringify(tradeFills.map(t => ({
  direction: t.direction,
  fillPrice: t.fillPrice,
  rsi: t.rsi,
  volumeRatio: t.vwap > 0 ? (t.fillPrice / t.vwap).toFixed(3) : 'N/A',
  mode: t.trading_mode,
})), null, 2) : 'No trades executed today.'}

=== TASK ===
Based on the contrast between aborted signals and executed trades:
1. Identify if the static RSI bounds [55,65] for CE and [35,45] for PE are too restrictive.
2. Identify if the volume gate is blocking too many valid signals.
3. Suggest adjusted thresholds that would capture more valid signals WITHOUT increasing false positives.
4. Your recommendation should be conservative — a ±5 maximum shift from the current static values per day.

Return ONLY a valid JSON object with exactly these keys:
{
  "ce_rsi_min": number,
  "ce_rsi_max": number,
  "pe_rsi_min": number,
  "pe_rsi_max": number,
  "volume_multiplier": number,
  "reasoning": string
}

Ensure ce_rsi_min >= 40, ce_rsi_max <= 80, pe_rsi_min >= 20, pe_rsi_max <= 60, volume_multiplier between 0.5 and 1.5.
`;

  console.log('[POST-MARKET-ANALYZER] Calling Groq llama-3.1-8b-instant...');
  const rawResponse = await callGroq(prompt);

  let config: any;
  try {
    config = JSON.parse(rawResponse);
  } catch (e) {
    throw new Error(`Groq returned invalid JSON: ${rawResponse.substring(0, 200)}`);
  }

  // ── 4. Validate bounds ───────────────────────────────────────────────────
  const safe = {
    ce_rsi_min: Math.max(40, Math.min(60, config.ce_rsi_min ?? 55)),
    ce_rsi_max: Math.max(60, Math.min(80, config.ce_rsi_max ?? 65)),
    pe_rsi_min: Math.max(20, Math.min(40, config.pe_rsi_min ?? 35)),
    pe_rsi_max: Math.max(40, Math.min(60, config.pe_rsi_max ?? 45)),
    volume_multiplier: Math.max(0.5, Math.min(1.5, config.volume_multiplier ?? 1.0)),
  };

  console.log(`[POST-MARKET-ANALYZER] Validated config: ${JSON.stringify(safe)}`);
  console.log(`[POST-MARKET-ANALYZER] LLM reasoning: ${config.reasoning ?? 'Not provided'}`);

  // ── 5. Upsert to Supabase confluence_config ──────────────────────────────
  const { error: upsertError } = await supabase
    .from('confluence_config')
    .upsert({
      date: today,
      ...safe,
      generated_by: 'llm',
      llm_reasoning: config.reasoning ?? null,
    }, { onConflict: 'date' });

  if (upsertError) {
    throw new Error(`Supabase upsert failed: ${upsertError.message}`);
  }

  // ── 6. Log to system_events ──────────────────────────────────────────────
  await supabase.from('system_events').insert({
    event_type: 'postmarket_analysis',
    payload: {
      date: today,
      signal_eval_count: signalEvals.length,
      confirmed_count: confirmedSignals.length,
      abort_categories: Object.keys(abortSummary),
      recommended_config: safe,
    }
  });

  console.log(`[POST-MARKET-ANALYZER] ✅ Analysis complete. Thresholds for ${today} saved to confluence_config.`);
  console.log('[POST-MARKET-ANALYZER] The daemon will load these on next boot via loadConfluenceConfig().');
}

run().catch((err) => {
  console.error(`[POST-MARKET-ANALYZER] ❌ FATAL: ${err.message}`);
  process.exit(1);
});
