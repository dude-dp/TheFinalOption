import type { UpstoxCandle } from './types';

export function calculateVWAP(candles: UpstoxCandle[]): number {
  if (!candles || candles.length === 0) return 0;
  
  let cumulativeTPV = 0; // Typical Price * Volume
  let cumulativeVolume = 0;

  for (const c of candles) {
    // Typical Price = (High + Low + Close) / 3
    const typicalPrice = (c.high + c.low + c.close) / 3;
    
    // Fallback: If trading Spot Index (which has no volume), use 1 as a weight. 
    // This dynamically degrades the VWAP into an Anchored TWAP, perfectly preserving the mean-reversion logic.
    const vol = (c.volume && c.volume > 0) ? c.volume : 1; 

    cumulativeTPV += typicalPrice * vol;
    cumulativeVolume += vol;
  }

  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}
