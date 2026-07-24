import { Candle } from './adx.js';

/**
 * Calculates Relative Volume (RVOL).
 * Compares current candle's volume to average volume of same time slot in past N days.
 */
export function calculateRVOL(candles: Candle[], historicalCandles: Candle[][]): number {
  if (!candles || candles.length === 0) return 1.0;

  const currentCandle = candles[candles.length - 1];
  const currentVol = currentCandle.volume || 0;
  if (currentVol === 0) return 1.0;

  if (!historicalCandles || historicalCandles.length === 0) return 1.0;

  let totalSameSlotVolume = 0;
  let count = 0;

  for (const dayCandles of historicalCandles) {
    if (dayCandles && dayCandles.length > 0) {
      const match = dayCandles.find(c => c.timestamp && currentCandle.timestamp && c.timestamp.slice(11, 16) === currentCandle.timestamp.slice(11, 16));
      if (match && match.volume) {
        totalSameSlotVolume += match.volume;
        count++;
      }
    }
  }

  if (count === 0 || totalSameSlotVolume === 0) {
    // Fallback to simple average over recent candles
    const avgVol = candles.slice(0, -1).reduce((acc, c) => acc + (c.volume || 0), 0) / Math.max(1, candles.length - 1);
    return avgVol > 0 ? Number((currentVol / avgVol).toFixed(2)) : 1.0;
  }

  const avgSameSlotVol = totalSameSlotVolume / count;
  return Number((currentVol / avgSameSlotVol).toFixed(2));
}
