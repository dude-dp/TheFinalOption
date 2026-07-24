/**
 * Calculates percentage distance from daily session VWAP.
 * VWAP resets at the start of every day (matching current session timestamp).
 * Formula: ((LTP - VWAP) / VWAP) * 100
 */
export function calculateVWAPDistance(candles: any[]): number {
  if (!candles || candles.length === 0) return 0;

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle.timestamp) return 0;

  // Extract 'YYYY-MM-DD' to isolate today's trading session
  const todayStr = new Date(lastCandle.timestamp).toISOString().split('T')[0];

  let sumPV = 0; // Sum of (Price * Volume)
  let sumV = 0;  // Sum of Volume

  for (const c of candles) {
    if (c.timestamp) {
      const cDate = new Date(c.timestamp).toISOString().split('T')[0];
      
      // VWAP resets at the start of every day
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

  // Percentage distance from VWAP: ((LTP - VWAP) / VWAP) * 100
  const distancePct = ((lastCandle.close - vwap) / vwap) * 100;

  return Number(distancePct.toFixed(2));
}

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
