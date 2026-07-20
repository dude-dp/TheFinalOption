// ============================================
// Instrument Resolver
// Dynamically fetches the current NIFTY front-month
// futures instrument key from the Upstox master CSV.
//
// Run once on daemon boot. Handles monthly rollover
// automatically — no manual intervention needed.
// ============================================

import { logInfo, logError, logWarn } from './logger.js';
import zlib from 'zlib';

const INSTRUMENTS_URL = 'https://assets.upstox.com/market-assets/instruments/v1/NSE_FO.json.gz';

interface UpstoxInstrument {
  instrument_key: string;
  name: string;
  instrument_type: string;
  expiry: string; // 'YYYY-MM-DD'
  lot_size: number;
}

let _cachedFuturesKey: string | null = null;

/**
 * Resolves the instrument key for the nearest NIFTY front-month futures contract.
 *
 * Strategy:
 *   1. Downloads the Upstox NSE F&O instrument master (gzipped JSON).
 *   2. Filters for NIFTY FUT (not MINI, not BANK).
 *   3. Picks the contract with the nearest expiry >= today.
 *
 * Result is cached in-memory so subsequent calls are instant.
 * On monthly rollover, a daemon restart auto-refreshes to the new front-month.
 *
 * @returns The instrument key string, e.g. 'NSE_FO|NIFTY25JULFUT'
 */
export async function resolveNiftyFuturesKey(): Promise<string> {
  if (_cachedFuturesKey) return _cachedFuturesKey;

  logInfo('[INSTRUMENT-RESOLVER] Fetching Upstox NSE F&O instrument master...');

  try {
    const res = await fetch(INSTRUMENTS_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from Upstox instruments API`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Decompress gzip
    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(buffer, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const instruments: UpstoxInstrument[] = JSON.parse(decompressed.toString('utf-8'));

    // Filter: NIFTY front-month futures only (not NIFTYMINI, not BANKNIFTY)
    const todayStr = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

    const niftyFutures = instruments
      .filter(i =>
        i.instrument_type === 'FUT' &&
        i.name === 'NIFTY' &&
        i.expiry >= todayStr  // Only non-expired contracts
      )
      .sort((a, b) => a.expiry.localeCompare(b.expiry)); // Nearest expiry first

    if (niftyFutures.length === 0) {
      throw new Error('No active NIFTY futures contracts found in instrument master');
    }

    const frontMonth = niftyFutures[0];
    _cachedFuturesKey = frontMonth.instrument_key;

    logInfo(`[INSTRUMENT-RESOLVER] ✅ Resolved NIFTY Futures: ${_cachedFuturesKey} | Expiry: ${frontMonth.expiry} | Lot: ${frontMonth.lot_size}`);

    return _cachedFuturesKey;

  } catch (err: any) {
    logError(`[INSTRUMENT-RESOLVER] ❌ Failed to resolve NIFTY futures: ${err.message}`);
    // Fallback: hard-coded current front-month as a safety net
    // Update this only if the API is structurally broken, not monthly
    const fallback = 'NSE_FO|NIFTY25JULFUT';
    logWarn(`[INSTRUMENT-RESOLVER] Using hardcoded fallback: ${fallback}`);
    return fallback;
  }
}

/** Clears the cache — useful if you want to force a re-resolve mid-session */
export function clearInstrumentCache(): void {
  _cachedFuturesKey = null;
  logInfo('[INSTRUMENT-RESOLVER] Cache cleared. Will re-resolve on next call.');
}
