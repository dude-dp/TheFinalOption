export interface Candle {
  high: number;
  low: number;
  close: number;
  open?: number;
  volume?: number;
  timestamp?: string;
}

/**
 * Average True Range (ATR 14) Calculation using Wilder's Smoothing Method (RMA)
 * Ensures smooth volatility decay matching TradingView / Institutional standards.
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period) return new Array(candles.length).fill(0);

  const tr: number[] = [];
  const atr: number[] = new Array(candles.length).fill(0);

  // 1. Calculate True Range (TR) for all candles
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
    } else {
      const highLow = candles[i].high - candles[i].low;
      const highClose = Math.abs(candles[i].high - candles[i - 1].close);
      const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
      tr.push(Math.max(highLow, highClose, lowClose));
    }
  }

  // 2. Initial ATR is the Simple Moving Average of the first 'period' TRs
  let sumTR = 0;
  for (let i = 0; i < period; i++) {
    sumTR += tr[i];
  }
  atr[period - 1] = sumTR / period;

  // 3. Subsequent ATRs use Wilder's Smoothing Method (RMA)
  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
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
