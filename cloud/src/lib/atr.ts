import type { UpstoxCandle } from './types';

export function calculateATR(candles: UpstoxCandle[], period: number = 14): number {
  if (!candles || candles.length < period) return 40; // Safe default NIFTY ATR

  const trueRanges: number[] = [];

  // 1. Calculate True Range for all available candles
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) period = trueRanges.length;

  // 2. Initial Simple Moving Average of TR
  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trueRanges[i];
  }
  atr /= period;

  // 3. Wilder's Smoothing for the rest of the array
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return atr;
}

export function calculateATRArray(candles: UpstoxCandle[], period: number = 14): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  if (!candles || candles.length < period) return result;

  const trueRanges: number[] = new Array(candles.length).fill(0);

  // 1. Calculate True Range
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trueRanges[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
  }

  // 2. Initial Simple Moving Average of TR
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    atr += trueRanges[i];
  }
  atr /= period;
  result[period] = atr;

  // 3. Wilder's Smoothing
  for (let i = period + 1; i < candles.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    result[i] = atr;
  }

  return result;
}
