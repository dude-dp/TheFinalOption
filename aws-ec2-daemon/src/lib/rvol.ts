export function calculateRVOL(candles: any[]): number {
  if (!candles || candles.length < 2) return 1.0;

  const currentCandle = candles[candles.length - 1];
  if (!currentCandle.volume || currentCandle.volume === 0) return 1.0;

  // Helper to extract "HH:MM" string for time-matching
  const getTime = (ts: string | number) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const targetTime = getTime(currentCandle.timestamp);
  let historicalVolSum = 0;
  let count = 0;

  // Look backward through history to find candles matching THIS EXACT TIME OF DAY
  for (let i = candles.length - 2; i >= 0; i--) {
    const candleTime = getTime(candles[i].timestamp);
    if (candleTime && candleTime === targetTime && candles[i].volume) {
      historicalVolSum += candles[i].volume;
      count++;
    }
  }

  // If no historical data for this time slot, default to 1.0 (baseline)
  if (count === 0 || historicalVolSum === 0) return 1.0;

  const avgHistoricalVol = historicalVolSum / count;
  const rvol = currentCandle.volume / avgHistoricalVol;

  return Number(rvol.toFixed(2));
}
