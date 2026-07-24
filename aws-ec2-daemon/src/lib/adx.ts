export interface Candle {
  high: number;
  low: number;
  close: number;
  open?: number;
  volume?: number;
  timestamp?: string;
}

/**
 * Average Directional Index (ADX 14) Calculation
 * Calculates +DI, -DI, and ADX series.
 */
export function calculateADX(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period * 2) {
    return new Array(candles.length).fill(0);
  }

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    const trValue = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    tr.push(trValue);
  }

  let smoothedTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArray: number[] = [];

  const calcDX = (pDM: number, mDM: number, trVal: number) => {
    if (trVal === 0) return 0;
    const pDI = (pDM / trVal) * 100;
    const mDI = (mDM / trVal) * 100;
    const sum = pDI + mDI;
    return sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100;
  };

  dxArray.push(calcDX(smoothedPlusDM, smoothedMinusDM, smoothedTR));

  for (let i = period; i < tr.length; i++) {
    smoothedTR = smoothedTR - smoothedTR / period + tr[i];
    smoothedPlusDM = smoothedPlusDM - smoothedPlusDM / period + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - smoothedMinusDM / period + minusDM[i];
    dxArray.push(calcDX(smoothedPlusDM, smoothedMinusDM, smoothedTR));
  }

  const adx: number[] = new Array(period * 2).fill(0);
  if (dxArray.length >= period) {
    let adxValue = dxArray.slice(0, period).reduce((a, b) => a + b, 0) / period;
    adx.push(adxValue);

    for (let i = period; i < dxArray.length; i++) {
      adxValue = (adxValue * (period - 1) + dxArray[i]) / period;
      adx.push(adxValue);
    }
  }

  // Pad to match input length if needed
  while (adx.length < candles.length) {
    adx.unshift(0);
  }

  return adx;
}
