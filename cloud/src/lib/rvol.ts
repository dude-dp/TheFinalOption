/**
 * Relative Volume (RVOL)
 * Compares current candle volume against the average volume at the same
 * time-of-day from historical candles in the same dataset.
 * Returns a ratio: 1.0 = average, 2.0 = double average, etc.
 */
export function calculateRVOL(candles: any[]): number {
  if (!candles || candles.length < 2) return 1.0;

  const currentCandle = candles[candles.length - 1];
  if (!currentCandle.volume || currentCandle.volume === 0) return 1.0;

  const getTime = (ts: string | number) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const targetTime = getTime(currentCandle.timestamp);
  let historicalVolSum = 0;
  let count = 0;

  for (let i = candles.length - 2; i >= 0; i--) {
    const candleTime = getTime(candles[i].timestamp);
    if (candleTime && candleTime === targetTime && candles[i].volume) {
      historicalVolSum += candles[i].volume;
      count++;
    }
  }

  if (count === 0 || historicalVolSum === 0) return 1.0;

  const avgHistoricalVol = historicalVolSum / count;
  return Number((currentCandle.volume / avgHistoricalVol).toFixed(2));
}
