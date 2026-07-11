// cloud/src/lib/pcr.ts
import type { UpstoxOptionChainEntry } from './types';

export function calculatePCR(chain: UpstoxOptionChainEntry[]): number {
  if (!chain || chain.length === 0) return 1.0; // Default to neutral if data is missing

  let totalPutOI = 0;
  let totalCallOI = 0;

  for (const option of chain) {
    if (option.optionType === 'PE') {
      totalPutOI += option.openInterest || 0;
    } else if (option.optionType === 'CE') {
      totalCallOI += option.openInterest || 0;
    }
  }

  // Prevent division by zero just in case of an API anomaly
  if (totalCallOI === 0) return 1.0; 

  return totalPutOI / totalCallOI;
}
