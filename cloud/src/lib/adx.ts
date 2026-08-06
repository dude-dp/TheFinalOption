// ============================================
// ADX — Average Directional Index (Period 14)
// Two exports:
//   calculateADX()       → single scalar (latest value)
//   calculateADXSeries() → full array (used by screener)
// ============================================

import type { Candle } from './types';

/**
 * Returns the full ADX series aligned to the input candles array.
 * Used by the MTF Screener which indexes [adxSeries.length - 1].
 */
export function calculateADXSeries(candles: Candle[], period = 14): number[] {
  const result = new Array(candles.length).fill(0);
  if (candles.length < period * 2) return result;

  let trSum = 0, pdmSum = 0, ndmSum = 0;

  for (let i = 1; i <= period; i++) {
    const cur = candles[i], prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low  - prev.close)
    );
    const upMove   = cur.high - prev.high;
    const downMove = prev.low  - cur.low;
    trSum  += tr;
    pdmSum += (upMove > downMove && upMove > 0)   ? upMove   : 0;
    ndmSum += (downMove > upMove && downMove > 0) ? downMove : 0;
  }

  let smoothedTR = trSum, smoothedPDM = pdmSum, smoothedNDM = ndmSum;
  let dxSum = 0, lastADX = 0;

  for (let i = period + 1; i < candles.length; i++) {
    const cur = candles[i], prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low  - prev.close)
    );
    const upMove   = cur.high - prev.high;
    const downMove = prev.low  - cur.low;
    const pdm = (upMove > downMove && upMove > 0)   ? upMove   : 0;
    const ndm = (downMove > upMove && downMove > 0) ? downMove : 0;

    smoothedTR  = smoothedTR  - smoothedTR  / period + tr;
    smoothedPDM = smoothedPDM - smoothedPDM / period + pdm;
    smoothedNDM = smoothedNDM - smoothedNDM / period + ndm;

    const pdi = (smoothedPDM / smoothedTR) * 100;
    const ndi = (smoothedNDM / smoothedTR) * 100;
    const dx  = (Math.abs(pdi - ndi) / (pdi + ndi)) * 100;

    if (i === period * 2 - 1) {
      dxSum += dx;
      lastADX = dxSum / period;
    } else if (i > period * 2 - 1) {
      lastADX = ((lastADX * (period - 1)) + dx) / period;
    } else {
      dxSum += dx;
    }

    result[i] = lastADX;
  }

  return result;
}
