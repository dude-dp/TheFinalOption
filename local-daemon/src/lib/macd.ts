// local-daemon/src/lib/macd.ts

/**
 * Calculate Exponential Moving Average for a series of closing prices.
 */
export function calculateEMA(closes: number[], period: number): number[] {
  if (closes.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const ema: number[] = [];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  ema.push(sum / period);

  for (let i = period; i < closes.length; i++) {
    const value = (closes[i] * multiplier) + (ema[ema.length - 1] * (1 - multiplier));
    ema.push(value);
  }

  return ema;
}

/**
 * Calculate the MACD indicator components.
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

  const ema12Offset = SLOW_PERIOD - FAST_PERIOD; // 14
  const macdLine: number[] = [];

  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + ema12Offset] - ema26[i]);
  }

  const signalLine = calculateEMA(macdLine, SIGNAL_PERIOD);

  const signalOffset = SIGNAL_PERIOD - 1;
  const histogram: number[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + signalOffset] - signalLine[i]);
  }

  return { macdLine, signalLine, histogram };
}

/**
 * Detect a MACD zero-line crossover between two consecutive values.
 */
export function detectZeroCrossover(
  currentMacd: number,
  previousMacd: number
): 'BUY_CE' | 'BUY_PE' | null {
  if (previousMacd <= 0 && currentMacd > 0) {
    return 'BUY_CE';
  }

  if (previousMacd >= 0 && currentMacd < 0) {
    return 'BUY_PE';
  }

  return null;
}

/**
 * Extract the latest MACD values needed for crossover detection.
 */
export function getLatestMACDValues(closes: number[]): {
  current: number;
  previous: number;
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
} | null {
  const MIN_CANDLES = 35;

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
