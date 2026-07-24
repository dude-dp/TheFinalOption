import { Candle } from './adx.js';

/**
 * Calculates Intraday VWAP for a set of candles.
 * VWAP = Sum(Typical Price * Volume) / Sum(Volume)
 * Typical Price = (High + Low + Close) / 3
 */
export function calculateVWAP(candles: Candle[]): number {
  if (!candles || candles.length === 0) return 0;

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.volume && c.volume > 0 ? c.volume : 1;
    cumulativeTPV += tp * vol;
    cumulativeVolume += vol;
  }

  if (cumulativeVolume === 0) return candles[candles.length - 1].close;
  return cumulativeTPV / cumulativeVolume;
}

/**
 * Computes percentage distance from VWAP.
 * Formula: ((LTP - VWAP) / VWAP) * 100
 */
export function calculateDistanceFromVWAP(ltp: number, vwap: number): number {
  if (!vwap || vwap === 0) return 0;
  const dist = ((ltp - vwap) / vwap) * 100;
  return Number(dist.toFixed(2));
}
