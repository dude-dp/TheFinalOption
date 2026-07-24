/**
 * Relative Strength Index (RSI 14) - Wilder's Smoothing
 * Returns an array of RSI values aligned to the input closes array.
 */
export function calculateRSI(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) {
    return new Array(closes.length).fill(50);
  }

  const rsiArray: number[] = new Array(period).fill(50);

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }

  avgGain /= period;
  avgLoss /= period;

  let firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiArray.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsiArray.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsiArray.push(100 - 100 / (1 + rs));
    }
  }

  return rsiArray;
}
