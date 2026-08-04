// ============================================
// MTF Screener Logic — Serverless Edition
// Ported from aws-ec2-daemon/src/mtf-screener.ts
// Pure functions: no Node.js, no logger imports
// ============================================

import { calculateMACD, calculateEMA } from './macd';
import { calculateRSI } from './rsi';
import { calculateADXSeries } from './adx';
import { calculateATR, calculateSuggestedSL } from './atr';
import { calculateVWAPDistance } from './vwap';
import { calculateRVOL } from './rvol';
import type { Candle, ScreenerSignalResult } from './types';

// ============================================================
// CANDLE PARSER — converts raw Upstox API array to Candle[]
// ============================================================

export function parseUpstoxCandles(rawCandles: any[][]): Candle[] {
  return rawCandles
    .map(c => ({
      timestamp: c[0] as string,
      open:   Number(c[1]),
      high:   Number(c[2]),
      low:    Number(c[3]),
      close:  Number(c[4]),
      volume: Number(c[5])
    }))
    .reverse(); // Upstox returns newest-first; we need oldest-first
}

// ============================================================
// MULTI-SIGNAL DETECTOR (30m)
// The quantitative gatekeeper. Returns null if no setup exists.
// ============================================================

export function detect30mSignals(candles: Candle[]): ScreenerSignalResult | null {
  const closes = candles.map(c => c.close);
  // Increased from 35 to 65 to allow for 5-Day Base Depth & 50 EMA calculations
  if (closes.length < 65) return null;

  const { macdLine, histogram } = calculateMACD(closes);
  if (macdLine.length < 3) return null;

  const currentMacd30m = macdLine[macdLine.length - 1];
  const prevMacd30m    = macdLine[macdLine.length - 2];
  const prev2Macd30m   = macdLine[macdLine.length - 3];
  const currentHist    = histogram[histogram.length - 1];

  const rsiSeries  = calculateRSI(closes, 14);
  const adxSeries  = calculateADXSeries(candles, 14);
  const atrSeries  = calculateATR(candles, 14);

  const currentRsi = rsiSeries[rsiSeries.length - 1];
  const currentAdx = adxSeries[adxSeries.length - 1];
  const currentAtr = atrSeries[atrSeries.length - 1];
  const price      = closes[closes.length - 1];
  const vwapDist   = calculateVWAPDistance(candles);
  const rvol       = calculateRVOL(candles);
  const suggestedSL = calculateSuggestedSL(price, currentAtr, 2.0);

  const currCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const currOpen = currCandle.open ?? currCandle.close;
  const prevOpen = prevCandle.open ?? prevCandle.close;

  // --- PHASE 2: DYNAMIC VOLATILITY THRESHOLDS (QUANT ATR UPGRADE) ---
  
  // 1. Trend Stack Order (Perfect Stack: Price > EMA9 > EMA21 > EMA50)
  const ema9  = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const currE9  = ema9[ema9.length - 1], prevE9 = ema9[ema9.length - 2];
  const currE21 = ema21[ema21.length - 1], prevE21 = ema21[ema21.length - 2];
  const currE50 = ema50[ema50.length - 1];
  
  const isPerfectStack = price > currE9 && currE9 > currE21 && currE21 > currE50;
  
  // 2. Volume Exhaustion (🤫 SELLERS DEAD — ATR Adjusted)
  // Current volume is < 60% of the 20-period average, and the candle body is <= 25% of 30m ATR (true volatility dead-zone)
  const last20Vols = candles.slice(-20).map(c => c.volume);
  const avgVol20 = last20Vols.reduce((a, b) => a + b, 0) / 20;
  const candleBody = Math.abs(currCandle.close - currOpen);
  const isSellersDead = currCandle.volume < (avgVol20 * 0.6) && (currentAtr > 0 ? candleBody <= (currentAtr * 0.25) : candleBody / currOpen < 0.003);

  // 3. 5-Day Base Depth (Tight Squeeze — ATR Adjusted)
  // In 30m timeframe, 1 day ≈ 13 candles. 5 days ≈ 65 candles.
  // Dynamic threshold: Base range <= 1.5x Daily ATR (Daily ATR ≈ sqrt(13) * 30m ATR ≈ 3.6 * currentAtr).
  // 1.5x Daily ATR = 1.5 * 3.6 * currentAtr ≈ 5.4 * currentAtr.
  const last65Candles = candles.slice(-65);
  const maxHigh65 = Math.max(...last65Candles.map(c => c.high));
  const minLow65 = Math.min(...last65Candles.map(c => c.low));
  const baseRange65 = maxHigh65 - minLow65;
  const baseDepthPct = (baseRange65 / minLow65) * 100;
  const maxAllowedBaseRange = currentAtr > 0 ? currentAtr * 5.4 : minLow65 * 0.045;
  const isTightBase = baseRange65 <= maxAllowedBaseRange;

  // 4. Intraday Coiling Ratio (Inside Bar / Volatility Contraction)
  const isCoiling = currCandle.high < prevCandle.high && currCandle.low > prevCandle.low;

  // 5. Support Proximity (The Dip Buy — ATR Adjusted)
  // Price is within 0.75x 30m ATR of the 21 EMA while the overall trend is up
  const distE21 = Math.abs(price - currE21);
  const maxAllowedDipDist = currentAtr > 0 ? currentAtr * 0.75 : currE21 * 0.0075;
  const isDipBuy = distE21 <= maxAllowedDipDist && currE21 > currE50 && currentRsi > 40 && currentRsi < 60;

  // --- ORIGINAL REACTIVE LOGIC ---
  const isZeroLineCross30m = prevMacd30m <= 0 && currentMacd30m > 0;
  const isApproachingZero =
    currentMacd30m < 0 &&
    currentMacd30m > prevMacd30m &&
    prevMacd30m > prev2Macd30m &&
    currentHist > 0 &&
    (currentMacd30m - prevMacd30m) > 0.5;

  const isRedPrev   = prevCandle.close < prevOpen;
  const isGreenCurr = currCandle.close > currOpen;
  const isBullishEngulfing = isRedPrev && isGreenCurr && currCandle.close > prevOpen && currOpen < prevCandle.close;
  
  const body        = Math.abs(currCandle.close - currOpen);
  const lowerShadow = Math.min(currOpen, currCandle.close) - currCandle.low;
  const upperShadow = currCandle.high - Math.max(currOpen, currCandle.close);
  const isHammer    = isGreenCurr && (lowerShadow >= 2 * body) && (upperShadow <= body * 0.5);

  const hasBullishPriceAction = isBullishEngulfing || isHammer;

  // --- THE GATEKEEPER ---
  // Allow if it's a pre-breakout setup OR an active breakout setup
  const isPreBreakout = (isTightBase && isSellersDead) || isDipBuy || (isPerfectStack && isCoiling);
  
  if (!(isZeroLineCross30m || isApproachingZero || (hasBullishPriceAction && currentMacd30m > -0.5) || isPreBreakout)) {
    return null;
  }

  // Build signal array
  const signals: string[] = [];

  // Push high-conviction Pre-Breakout signals first
  if (isTightBase && isSellersDead) signals.push('TIGHT_BASE_SQUEEZE');
  if (isSellersDead)                signals.push('VOL_EXHAUSTION');
  if (isDipBuy)                     signals.push('SUPPORT_DIP_BUY');
  if (isPerfectStack && isCoiling)  signals.push('PERFECT_TREND_STACK');

  // Push standard reactive signals
  if (isZeroLineCross30m)        signals.push('ZERO_LINE_CROSS');
  else if (isApproachingZero)    signals.push('APPROACHING_ZERO');
  else if (isBullishEngulfing)   signals.push('BULLISH_ENGULFING');
  else if (isHammer)             signals.push('HAMMER_REVERSAL');

  if (rsiSeries.length >= 3) {
    const r0 = rsiSeries[rsiSeries.length - 1];
    const r1 = rsiSeries[rsiSeries.length - 2];
    const r2 = rsiSeries[rsiSeries.length - 3];
    if (r2 < 35 && r1 <= r2 && r0 > r1) signals.push('RSI_REVERSAL');
    if (r1 < 50  && r0 >= 50)            signals.push('RSI_50_CROSS');
  }

  if (ema9.length >= 2 && ema21.length > (21 - 9) + 1) {
    if (prevE9 <= prevE21 && currE9 > currE21) signals.push('EMA_GOLDEN_CROSS');
  }

  return {
    signals,
    macdValue: currentMacd30m,
    rsi:       currentRsi,
    adx:       currentAdx,
    atr:       currentAtr,
    vwapDist,
    rvol,
    suggestedSL,
    price
  };
}

// ============================================================
// 3H / DAILY CONVICTION CHECK
// Called lazily only when 30m gate passes.
// Reuses the same candle array from a "day" interval fetch.
// ============================================================

export function check3HConviction(dailyCandles: Candle[]): boolean {
  if (dailyCandles.length < 20) return false;

  const closes3h = dailyCandles.map(c => c.close);
  const { macdLine } = calculateMACD(closes3h);
  if (macdLine.length < 2) return false;

  const curr3h = macdLine[macdLine.length - 1];
  const prev3h = macdLine[macdLine.length - 2];

  // Bullish if MACD is already above zero OR crossing from below right now
  return curr3h > 0 || (prev3h < 0 && curr3h > 0);
}

// ============================================================
// SIGNAL PRIORITY RESOLVER
// Maps signal array to a single canonical label
// ============================================================

const SIGNAL_PRIORITY = [
  'TIGHT_BASE_SQUEEZE', 'PERFECT_TREND_STACK', 'SUPPORT_DIP_BUY', 'VOL_EXHAUSTION', // New Predictive Signals Rank Highest
  'ZERO_LINE_CROSS', 'SIGNAL_LINE_CROSS', 'APPROACHING_ZERO',
  'EMA_GOLDEN_CROSS', 'BULLISH_ENGULFING', 'HAMMER_REVERSAL',
  'RSI_REVERSAL', 'RSI_50_CROSS', 'BULLISH_MOMENTUM'
];

export function resolvePrimarySignal(signals: string[]): string {
  return SIGNAL_PRIORITY.find(s => signals.includes(s)) || signals[0] || 'UNKNOWN';
}
