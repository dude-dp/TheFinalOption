// ============================================
// MACD Calculation Engine
// Moving Average Convergence Divergence (12, 26)
// Signal: Zero-line crossover (not signal-line)
// ============================================

/**
 * Calculate Exponential Moving Average for a series of closing prices.
 * 
 * EMA_n(t) = (V(t) × 2/(n+1)) + (EMA_n(t-1) × (1 - 2/(n+1)))
 * 
 * The first EMA value is seeded with the Simple Moving Average (SMA)
 * of the first `period` data points to reduce initialization noise.
 */
export function calculateEMA(closes: number[], period: number): number[] {
  if (closes.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const ema: number[] = [];

  // Seed with SMA of the first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  ema.push(sum / period);

  // Calculate subsequent EMA values
  for (let i = period; i < closes.length; i++) {
    const value = (closes[i] * multiplier) + (ema[ema.length - 1] * (1 - multiplier));
    ema.push(value);
  }

  return ema;
}

/**
 * Calculate the MACD indicator components.
 * 
 * MACD Line = EMA(12) - EMA(26)
 * 
 * We only need the MACD line for zero-line crossover detection.
 * The signal line (EMA 9 of MACD) and histogram are computed
 * for dashboard visualization purposes.
 * 
 * @param closes - Array of closing prices (oldest first)
 * @returns Object with macdLine, signalLine, and histogram arrays
 */
export function calculateMACD(closes: number[]): {
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
} {
  const FAST_PERIOD = 12;
  const SLOW_PERIOD = 26;
  const SIGNAL_PERIOD = 9;

  if (closes.length < SLOW_PERIOD) {
    return { macdLine: [], signalLine: [], histogram: [] };
  }

  const ema12 = calculateEMA(closes, FAST_PERIOD);
  const ema26 = calculateEMA(closes, SLOW_PERIOD);

  // Align EMA arrays: EMA12 starts at index 12, EMA26 starts at index 26
  // So MACD line starts at index 26 relative to the input
  // EMA12 has (closes.length - 12 + 1) entries starting from index 11
  // EMA26 has (closes.length - 26 + 1) entries starting from index 25
  // The overlap starts at input index 25 where:
  //   - EMA12[25 - 11] = EMA12[14]
  //   - EMA26[25 - 25] = EMA26[0]

  const ema12Offset = SLOW_PERIOD - FAST_PERIOD; // 14
  const macdLine: number[] = [];

  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + ema12Offset] - ema26[i]);
  }

  // Signal line: EMA(9) of MACD line
  const signalLine = calculateEMA(macdLine, SIGNAL_PERIOD);

  // Histogram: MACD line - Signal line
  const signalOffset = SIGNAL_PERIOD - 1;
  const histogram: number[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + signalOffset] - signalLine[i]);
  }

  return { macdLine, signalLine, histogram };
}

/**
 * Detect a MACD zero-line crossover between two consecutive values.
 * 
 * | Previous MACD    | Current MACD     | Signal    |
 * |------------------|------------------|-----------|
 * | ≤ 0              | > 0              | BUY_CE    |
 * | ≥ 0              | < 0              | BUY_PE    |
 * | otherwise        | otherwise        | null      |
 * 
 * @returns 'BUY_CE' for bullish crossover, 'BUY_PE' for bearish crossover, null otherwise
 */
export function detectZeroCrossover(
  currentMacd: number,
  previousMacd: number
): 'BUY_CE' | 'BUY_PE' | null {
  // Bullish crossover: MACD crosses from ≤ 0 to > 0
  if (previousMacd <= 0 && currentMacd > 0) {
    return 'BUY_CE';
  }

  // Bearish crossover: MACD crosses from ≥ 0 to < 0
  if (previousMacd >= 0 && currentMacd < 0) {
    return 'BUY_PE';
  }

  return null;
}

/**
 * Extract the latest MACD values needed for crossover detection.
 * Requires at least 27 closing prices (26 for EMA + 1 for comparison).
 * 
 * @param closes - Array of closing prices (oldest first), minimum 27 entries
 * @returns Current and previous MACD line values, or null if insufficient data
 */
export function getLatestMACDValues(closes: number[]): {
  current: number;
  previous: number;
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
} | null {
  const MIN_CANDLES = 35; // 26 for EMA warmup + buffer for stable readings

  if (closes.length < MIN_CANDLES) {
    return null;
  }

  const { macdLine, signalLine, histogram } = calculateMACD(closes);

  if (macdLine.length < 2) {
    return null;
  }

  return {
    current: macdLine[macdLine.length - 1],
    previous: macdLine[macdLine.length - 2],
    macdLine,
    signalLine,
    histogram,
  };
}
