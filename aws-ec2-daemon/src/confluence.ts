// ============================================
// Confluence Signal Engine
// VWAP Reclaim / Rejection Truth Table
// ============================================
// Pure functions only. No I/O, no side effects.
// Consumes LocalCandle[] from aggregator and emits
// typed ConfluenceSignal for routing to executor.
// ============================================

import type { LocalCandle } from './aggregator.js';
import { createClient } from '@supabase/supabase-js';

// ============================================
// Output Types
// ============================================

export interface ConfluenceSignal {
  signal: 'BUY_CE' | 'BUY_PE' | 'NONE';
  reason: string;
  vwap: number;
  ema9: number;
  ema21: number;
  rsi: number;
  volumeRatio: number; // currentCandle.volume / smaVolume — audit trail
}

// ============================================
// Indicator Implementations
// ============================================

/**
 * Exponential Moving Average (standard recursive EMA).
 * Requires at least `period` data points to produce a valid result.
 *
 * @param closes - Array of closing prices (oldest first)
 * @param period - EMA period
 * @returns Array of EMA values aligned to input length (first period-1 values are 0)
 */
export function calculateEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return new Array(closes.length).fill(0);

  const multiplier = 2 / (period + 1);
  const ema = new Array(closes.length).fill(0);

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  ema[period - 1] = sum / period;

  for (let i = period; i < closes.length; i++) {
    ema[i] = (closes[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

/**
 * Relative Strength Index — Wilder's smoothing method.
 * Returns the latest RSI value from the candle series.
 * Returns 50 (neutral) if insufficient data.
 *
 * @param closes - Array of closing prices (oldest first)
 * @param period - RSI period (default 14)
 */
export function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  // Initial averages over first `period` changes
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Intraday VWAP calculated from LocalCandle tick data.
 * Uses tick count as the volume weight (since NIFTY 50 Spot index has no
 * native volume — this degrades gracefully to a volume-weighted TWAP).
 *
 * IMPORTANT: Must be called with candles from the START of the trading
 * session (09:15 IST) to compute a valid intraday VWAP anchor.
 *
 * @param candles - Array of LocalCandle from aggregator (oldest first)
 */
export function calculateVWAPFromLocalCandles(candles: LocalCandle[]): number {
  if (!candles || candles.length === 0) return 0;

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 1;
    cumulativeTPV += typicalPrice * vol;
    cumulativeVolume += vol;
  }

  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}

/**
 * Simple Moving Average of candle volume (tick count).
 * Used as the baseline to confirm a volume-confirmed breakout.
 *
 * @param candles - Closed candle array
 * @param period  - Number of candles to average (default 10)
 */
export function calculateSMAVolume(candles: LocalCandle[], period: number = 10): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  const total = slice.reduce((sum, c) => sum + c.volume, 0);
  return total / period;
}

// ============================================
// Pattern Detectors
// ============================================

/**
 * VWAP Reclaim Detector (Bullish — CE signal setup).
 *
 * Looser confirmation (user-approved):
 *   1. At least ONE candle closed BELOW the VWAP in the last 5 candles (the dip)
 *   2. The MOST RECENT closed candle closed ABOVE VWAP (the reclaim)
 *   3. The reclaim candle has a bullish body (close > open) for quality confirmation
 */
function detectVwapReclaim(candles: LocalCandle[], vwap: number): boolean {
  if (candles.length < 6) return false;

  const triggerCandle = candles[candles.length - 1];
  const priorWindow = candles.slice(-6, -1); // 5 candles before the trigger

  const hadDipBelowVwap = priorWindow.some(c => c.close < vwap);
  const strongReclaimClose = triggerCandle.close > vwap;
  const bullishBody = triggerCandle.close > triggerCandle.open;

  return hadDipBelowVwap && strongReclaimClose && bullishBody;
}

/**
 * VWAP Rejection Detector (Bearish — PE signal setup).
 *
 * Pattern:
 *   1. The candle high challenged (touched or exceeded) the VWAP from below
 *   2. The candle closed BELOW the VWAP (rejection confirmed)
 *   3. Meaningful upper wick exists (wick > 50% of candle body)
 */
function detectVwapRejection(candles: LocalCandle[], vwap: number): boolean {
  if (candles.length < 2) return false;

  const trigger = candles[candles.length - 1];

  const challengedVwap = trigger.high >= vwap;
  const closedBelowVwap = trigger.close < vwap;

  const body = Math.abs(trigger.close - trigger.open);
  const upperWick = trigger.high - Math.max(trigger.open, trigger.close);
  const meaningfulWick = body > 0 ? upperWick > body * 0.5 : upperWick > 0.5;

  return challengedVwap && closedBelowVwap && meaningfulWick;
}

// ============================================
// Main Confluence Evaluator (The Truth Table)
// ============================================

const MARKET_START_HOUR_IST = 9;
const MARKET_START_MIN_IST = 30;

// Mutable so loadConfluenceConfig() can override with LLM-tuned values at boot
let CE_RSI_MIN = 55;
let CE_RSI_MAX = 65;
let PE_RSI_MIN = 35;
let PE_RSI_MAX = 45;
let BASE_VOLUME_MULTIPLIER = 1.0; // base volume SMA multiplier (tuned daily)

/**
 * Load LLM-tuned thresholds from the confluence_config Supabase table.
 *
 * Called once during StateEngine.initialize() on daemon boot.
 * If no row exists for today, the static defaults above remain in effect.
 * If the LLM has produced yesterday's config, it is NOT used — only today's row.
 */
export async function loadConfluenceConfig(): Promise<void> {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
    );

    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('confluence_config')
      .select('ce_rsi_min, ce_rsi_max, pe_rsi_min, pe_rsi_max, volume_multiplier')
      .eq('date', today)
      .single();

    if (error || !data) {
      console.log('[CONFLUENCE-CONFIG] No LLM config for today. Using static defaults.');
      return;
    }

    // Apply bounds validation before overriding
    CE_RSI_MIN = Math.max(40, Math.min(60, Number(data.ce_rsi_min)));
    CE_RSI_MAX = Math.max(60, Math.min(80, Number(data.ce_rsi_max)));
    PE_RSI_MIN = Math.max(20, Math.min(40, Number(data.pe_rsi_min)));
    PE_RSI_MAX = Math.max(40, Math.min(60, Number(data.pe_rsi_max)));
    BASE_VOLUME_MULTIPLIER = Math.max(0.5, Math.min(1.5, Number(data.volume_multiplier ?? 1.0)));

    console.log(`[CONFLUENCE-CONFIG] ✅ LLM-tuned thresholds loaded for ${today}:`);
    console.log(`  CE RSI: [${CE_RSI_MIN}, ${CE_RSI_MAX}] | PE RSI: [${PE_RSI_MIN}, ${PE_RSI_MAX}] | Vol×: ${BASE_VOLUME_MULTIPLIER}`);
  } catch (err: any) {
    console.warn(`[CONFLUENCE-CONFIG] Config load failed (non-critical): ${err.message}. Using defaults.`);
  }
}

/**
 * Evaluate the full multi-layer confluence matrix against the closed candle array.
 *
 * Called on every 1-minute candle close from ws-client.ts → StateEngine.evaluateAndRoute().
 * Returns a typed ConfluenceSignal with a reason string for audit logging.
 *
 * Minimum candles required: 25 (21-EMA needs 21, RSI needs 15, reclaim pattern needs 6)
 *
 * @param candles             - Closed 1-minute LocalCandle array (oldest first)
 * @param currentTime         - Current wall-clock time (UTC); offset to IST internally
 * @param volatilityMultiplier - TPS velocity multiplier from VarianceEngine (default 1.0).
 *                               At 1.0x (normal market): bounds are static defaults.
 *                               At 3.0x (spike regime): RSI bounds widen by min(15, 2×10)=20→capped at ±15.
 *                               Formula: RSI_dynamic = RSI_static ± min(MAX_DELTA, (λ - 1) × 10)
 *                               Volume threshold: smaVolume × max(0.5, 1 / λ)
 */
export function evaluateConfluence(
  candles: LocalCandle[],
  currentTime: Date,
  volatilityMultiplier: number = 1.0
): ConfluenceSignal {

  const NONE = (reason: string, extras?: Partial<ConfluenceSignal>): ConfluenceSignal => ({
    signal: 'NONE', reason,
    vwap: extras?.vwap ?? 0,
    ema9: extras?.ema9 ?? 0,
    ema21: extras?.ema21 ?? 0,
    rsi: extras?.rsi ?? 0,
    volumeRatio: extras?.volumeRatio ?? 0,
  });

  // ── Gate 1: Time Filter (09:50 IST hard lock) ──────────────────────────
  // Market opens at 09:15. We wait 35 minutes for initial volatility
  // to settle before allowing any setups.
  const timeLimit = new Date(currentTime);
  timeLimit.setUTCHours(4, 20, 0, 0); // 04:20 UTC = 09:50 IST

  if (currentTime.getTime() < timeLimit.getTime()) {
    const istHour = currentTime.getUTCHours() + 5 + (currentTime.getUTCMinutes() + 30 >= 60 ? 1 : 0);
    const istMin = (currentTime.getUTCMinutes() + 30) % 60;
    return NONE(`TIME_LOCK: Before 09:50 IST (${istHour}:${String(istMin).padStart(2, '0')})`);
  }

  // ── Gate 2: Minimum data check ─────────────────────────────────────────
  if (candles.length < 25) {
    return NONE(`INSUFFICIENT_DATA: Only ${candles.length} candles (need 25)`);
  }

  // ── Indicator Calculations ─────────────────────────────────────────────
  const closes = candles.map(c => c.close);
  const vwap = calculateVWAPFromLocalCandles(candles);
  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const rsi = calculateRSI(closes, 14);
  const smaVolume = calculateSMAVolume(candles, 10);

  const ema9 = ema9Arr[ema9Arr.length - 1];
  const ema21 = ema21Arr[ema21Arr.length - 1];
  const currentCandle = candles[candles.length - 1];
  const spotPrice = currentCandle.close;
  const volumeRatio = smaVolume > 0 ? currentCandle.volume / smaVolume : 0;

  const indicators = { vwap, ema9, ema21, rsi, volumeRatio };

  // ── Dynamic Threshold Widening (Variance-Aware) ───────────────────────
  // Clamp expansion to ±15 RSI points from static center regardless of λ.
  // Formula: bound ± min(MAX_DELTA, (λ - 1) × 10)
  // At λ=1.0: no change. At λ=2.0: ±10 pts. At λ=2.5: ±15 pts (capped).
  const MAX_RSI_DELTA = 15;
  const λ = Math.max(1.0, volatilityMultiplier); // floor at 1.0
  const rsiExpansion = Math.min(MAX_RSI_DELTA, (λ - 1) * 10);

  const dynCeRsiMin = CE_RSI_MIN - rsiExpansion;  // Widens downward
  const dynCeRsiMax = CE_RSI_MAX + rsiExpansion;  // Widens upward
  const dynPeRsiMin = PE_RSI_MIN - rsiExpansion;
  const dynPeRsiMax = PE_RSI_MAX + rsiExpansion;

  // Volume gate: at high λ, thin order books are normal — lower the bar
  // Never drop below 50% of SMA to prevent trading on noise
  const volumeThreshold = smaVolume * Math.max(0.5, 1 / λ);

  if (rsiExpansion > 0) {
    // Log so post-market analyzer can see correlation
    // (not using logInfo here to avoid flooding — asyncLog handles it)
  }

  if (vwap === 0) return NONE('VWAP_INVALID: No volume data to anchor VWAP', indicators);

  // ── Bullish Truth Table (CE Signal) ───────────────────────────────────
  if (spotPrice > vwap) {
    if (ema9 < ema21) {
      return NONE(`CE_ABORT: 9EMA (${ema9.toFixed(2)}) below 21EMA (${ema21.toFixed(2)})`, indicators);
    }
    if (rsi < dynCeRsiMin || rsi > dynCeRsiMax) {
      return NONE(`CE_ABORT: RSI ${rsi.toFixed(1)} outside [${dynCeRsiMin.toFixed(0)}, ${dynCeRsiMax.toFixed(0)}]${rsiExpansion > 0 ? ` (widened ${rsiExpansion.toFixed(0)}pts at ${λ.toFixed(1)}x TPS)` : ''}`, indicators);
    }
    if (currentCandle.volume <= volumeThreshold) {
      return NONE(`CE_ABORT: Volume ${currentCandle.volume} not above threshold ${volumeThreshold.toFixed(1)}${rsiExpansion > 0 ? ` (lowered at ${λ.toFixed(1)}x TPS)` : ''}`, indicators);
    }
    return {
      signal: 'BUY_CE',
      reason: `CE_CONFIRMED: Spot>${vwap.toFixed(2)} | 9EMA=${ema9.toFixed(2)}>${ema21.toFixed(2)} | RSI=${rsi.toFixed(1)} | Vol=${volumeRatio.toFixed(2)}x${rsiExpansion > 0 ? ` | λ=${λ.toFixed(1)}x` : ''}`,
      ...indicators,
    };
  }

  // ── Bearish Truth Table (PE Signal) ───────────────────────────────────
  if (spotPrice < vwap) {
    if (ema9 > ema21) {
      return NONE(`PE_ABORT: 9EMA (${ema9.toFixed(2)}) above 21EMA (${ema21.toFixed(2)})`, indicators);
    }
    if (rsi < dynPeRsiMin || rsi > dynPeRsiMax) {
      return NONE(`PE_ABORT: RSI ${rsi.toFixed(1)} outside [${dynPeRsiMin.toFixed(0)}, ${dynPeRsiMax.toFixed(0)}]${rsiExpansion > 0 ? ` (widened ${rsiExpansion.toFixed(0)}pts at ${λ.toFixed(1)}x TPS)` : ''}`, indicators);
    }
    if (currentCandle.volume <= volumeThreshold) {
      return NONE(`PE_ABORT: Volume ${currentCandle.volume} not above threshold ${volumeThreshold.toFixed(1)}${rsiExpansion > 0 ? ` (lowered at ${λ.toFixed(1)}x TPS)` : ''}`, indicators);
    }
    return {
      signal: 'BUY_PE',
      reason: `PE_CONFIRMED: Spot<${vwap.toFixed(2)} | 9EMA=${ema9.toFixed(2)}<${ema21.toFixed(2)} | RSI=${rsi.toFixed(1)} | Vol=${volumeRatio.toFixed(2)}x${rsiExpansion > 0 ? ` | λ=${λ.toFixed(1)}x` : ''}`,
      ...indicators,
    };
  }

  // Spot exactly at VWAP — no directional bias
  return NONE(`NEUTRAL: Spot(${spotPrice}) at VWAP(${vwap.toFixed(2)}) — no bias`, indicators);
}
