import { UpstoxCandle } from './types';

export function calculateADX(candles: UpstoxCandle[], period = 14): number {
  if (candles.length < period * 2) {
    return 0; // Not enough data for smoothed ADX
  }

  let trSum = 0;
  let pdmSum = 0;
  let ndmSum = 0;

  // Initial True Range and Directional Movement
  for (let i = 1; i <= period; i++) {
    const current = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );

    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;

    let pdm = 0;
    let ndm = 0;

    if (upMove > downMove && upMove > 0) {
      pdm = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      ndm = downMove;
    }

    trSum += tr;
    pdmSum += pdm;
    ndmSum += ndm;
  }

  let smoothedTR = trSum;
  let smoothedPDM = pdmSum;
  let smoothedNDM = ndmSum;
  let dxSum = 0;

  let lastADX = 0;

  for (let i = period + 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );

    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;

    let pdm = 0;
    let ndm = 0;

    if (upMove > downMove && upMove > 0) {
      pdm = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      ndm = downMove;
    }

    smoothedTR = smoothedTR - (smoothedTR / period) + tr;
    smoothedPDM = smoothedPDM - (smoothedPDM / period) + pdm;
    smoothedNDM = smoothedNDM - (smoothedNDM / period) + ndm;

    const pdi = (smoothedPDM / smoothedTR) * 100;
    const ndi = (smoothedNDM / smoothedTR) * 100;

    const dx = (Math.abs(pdi - ndi) / (pdi + ndi)) * 100;
    
    if (i === period * 2 - 1) {
      dxSum += dx;
      lastADX = dxSum / period;
    } else if (i > period * 2 - 1) {
      lastADX = ((lastADX * (period - 1)) + dx) / period;
    } else {
      dxSum += dx;
    }
  }

  return lastADX;
}
