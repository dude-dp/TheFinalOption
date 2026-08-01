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
  if (closes.length < 35) return null;

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

  // 1. Classic AutoBot Zero-Line Cross
  const isZeroLineCross30m = prevMacd30m <= 0 && currentMacd30m > 0;

  // 2. Anticipatory "Approaching Zero" Logic
  const isApproachingZero =
    currentMacd30m < 0 &&
    currentMacd30m > prevMacd30m &&
    prevMacd30m > prev2Macd30m &&
    currentHist > 0 &&
    (currentMacd30m - prevMacd30m) > 0.5;

  // 3. Candlestick Pattern Recognition
  const currOpen = currCandle.open ?? currCandle.close;
  const prevOpen = prevCandle.open ?? prevCandle.close;

  const isRedPrev   = prevCandle.close < prevOpen;
  const isGreenCurr = currCandle.close > currOpen;

  const isBullishEngulfing =
    isRedPrev && isGreenCurr &&
    currCandle.close > prevOpen &&
    currOpen < prevCandle.close;

  const body        = Math.abs(currCandle.close - currOpen);
  const lowerShadow = Math.min(currOpen, currCandle.close) - currCandle.low;
  const upperShadow = currCandle.high - Math.max(currOpen, currCandle.close);
  const isHammer    = isGreenCurr && (lowerShadow >= 2 * body) && (upperShadow <= body * 0.5);

  const hasBullishPriceAction = isBullishEngulfing || isHammer;

  // --- THE GATEKEEPER ---
  if (!(isZeroLineCross30m || isApproachingZero || (hasBullishPriceAction && currentMacd30m > -0.5))) {
    return null;
  }

  // Build signal array
  const signals: string[] = [];

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

  const ema9  = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  if (ema9.length >= 2 && ema21.length > (21 - 9) + 1) {
    const currE9  = ema9[ema9.length - 1],   prevE9  = ema9[ema9.length - 2];
    const currE21 = ema21[ema21.length - 1], prevE21 = ema21[ema21.length - 2];
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
  'ZERO_LINE_CROSS', 'SIGNAL_LINE_CROSS', 'APPROACHING_ZERO',
  'EMA_GOLDEN_CROSS', 'BULLISH_ENGULFING', 'HAMMER_REVERSAL',
  'RSI_REVERSAL', 'RSI_50_CROSS', 'BULLISH_MOMENTUM'
];

export function resolvePrimarySignal(signals: string[]): string {
  return SIGNAL_PRIORITY.find(s => signals.includes(s)) || signals[0] || 'UNKNOWN';
}
