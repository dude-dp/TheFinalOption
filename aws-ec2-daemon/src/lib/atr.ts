import { Candle } from './adx.js';

/**
 * Average True Range (ATR 14) Calculation
 * Used for dynamic structural stop loss determination.
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period + 1) {
    return new Array(candles.length).fill(0);
  }

  const trs: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trs.push(tr);
  }

  const atrSeries: number[] = new Array(period - 1).fill(0);

  let initialAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atrSeries.push(initialAtr);

  for (let i = period; i < trs.length; i++) {
    const currentAtr = (atrSeries[atrSeries.length - 1] * (period - 1) + trs[i]) / period;
    atrSeries.push(currentAtr);
  }

  return atrSeries;
}

/**
 * Calculates suggested ATR-based structural Stop Loss for long setups.
 * Suggested SL = Current Price - (Multiplier * ATR)
 */
export function calculateSuggestedSL(
  currentPrice: number,
  atr: number,
  multiplier: number = 2.0
): number {
  if (!atr || atr <= 0) return Number((currentPrice * 0.98).toFixed(2));
  const sl = currentPrice - multiplier * atr;
  return Number(Math.max(0, sl).toFixed(2));
}
