/**
 * VWAP — Volume Weighted Average Price
 *
 * Two exports:
 *   calculateVWAP()         → Returns the raw VWAP price for the current day's session.
 *   calculateVWAPDistance() → Returns % distance of LTP from VWAP.
 *                             Positive = above VWAP (bullish), Negative = below (bearish).
 *
 * VWAP resets at the start of every calendar day, matching the intraday session.
 */

export function calculateVWAP(candles: any[]): number {
  if (!candles || candles.length === 0) return 0;
  const lastCandle = candles[candles.length - 1];
  const todayStr = new Date(lastCandle.timestamp).toISOString().split('T')[0];
  let sumPV = 0;
  let sumV = 0;
  for (const c of candles) {
    if (c.timestamp && new Date(c.timestamp).toISOString().split('T')[0] === todayStr) {
      const tp = (c.high + c.low + c.close) / 3;
      const vol = c.volume || 1;
      sumPV += tp * vol;
      sumV += vol;
    }
  }
  return sumV === 0 ? lastCandle.close : sumPV / sumV;
}

/**
 * Returns the percentage distance of the last close from VWAP.
 * Formula: ((LTP - VWAP) / VWAP) × 100
 */
export function calculateVWAPDistance(candles: any[]): number {
  if (!candles || candles.length === 0) return 0;

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle.timestamp) return 0;

  const todayStr = new Date(lastCandle.timestamp).toISOString().split('T')[0];
  let sumPV = 0;
  let sumV = 0;

  for (const c of candles) {
    if (c.timestamp) {
      const cDate = new Date(c.timestamp).toISOString().split('T')[0];
      if (cDate === todayStr) {
        const typicalPrice = (c.high + c.low + c.close) / 3;
        const volume = c.volume || 1;
        sumPV += typicalPrice * volume;
        sumV += volume;
      }
    }
  }

  const vwap = sumV === 0 ? lastCandle.close : sumPV / sumV;
  if (!vwap || vwap === 0) return 0;

  return Number(((lastCandle.close - vwap) / vwap * 100).toFixed(2));
}
