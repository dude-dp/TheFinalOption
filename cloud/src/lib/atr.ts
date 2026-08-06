// ============================================
// ATR — Average True Range (Wilder's RMA)
// + Suggested Stop Loss Calculator
// ============================================

import type { Candle } from './types';

/**
 * ATR (14) using Wilder's Smoothing (RMA).
 * Returns an array of ATR values aligned to the input candles.
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period) return new Array(candles.length).fill(0);

  const tr: number[] = [];
  const atr: number[] = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
    } else {
      const highLow  = candles[i].high - candles[i].low;
      const highClose = Math.abs(candles[i].high - candles[i - 1].close);
      const lowClose  = Math.abs(candles[i].low  - candles[i - 1].close);
      tr.push(Math.max(highLow, highClose, lowClose));
    }
  }

  let sumTR = 0;
  for (let i = 0; i < period; i++) sumTR += tr[i];
  atr[period - 1] = sumTR / period;

  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

/**
 * Suggested structural Stop Loss for a long setup.
 * SL = CurrentPrice - (Multiplier × ATR)
 */
export function calculateSuggestedSL(
  currentPrice: number,
  atr: number,
  multiplier: number = 2.0
): number {
  if (!atr || atr <= 0) return Number((currentPrice * 0.98).toFixed(2));
  return Number(Math.max(0, currentPrice - multiplier * atr).toFixed(2));
}
