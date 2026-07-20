// ============================================
// Instrument Resolver
// ============================================
// Boot-time resolution strategy (two-tier):
//
// TIER 1 (primary): Query Supabase instrument_cache for today's pre-resolved
//   key. The cron-prewarmer.ts populates this row at 07:55 IST daily.
//   Zero network calls to Upstox during live market hours.
//
// TIER 2 (fallback): If no DB row exists (first boot before cron ran,
//   or Supabase unreachable), fall back to inline download of the Upstox
//   gzip instrument master. Same expiry-validated logic as cron-prewarmer.
//
// Result is cached in-memory so subsequent calls are instant.
// ============================================

import { logInfo, logError, logWarn } from './logger.js';
import { createClient } from '@supabase/supabase-js';
import zlib from 'zlib';

const INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz';

interface UpstoxInstrument {
  instrument_key: string;
  name: string;
  instrument_type: string;
  expiry: string; // 'YYYY-MM-DD'
  lot_size: number;
}

export interface ResolvedInstrument {
  futuresKey: string;
  lotSize: number;
  expiry: string;
}

let _cached: ResolvedInstrument | null = null;

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Tier 1: Try to read today's pre-resolved instrument from Supabase.
 * The cron-prewarmer populates this at 07:55 IST daily.
 */
async function resolveFromDB(): Promise<ResolvedInstrument | null> {
  try {
    const today = todayISO();
    const { data, error } = await supabase
      .from('instrument_cache')
      .select('futures_key, lot_size, expiry')
      .eq('date', today)
      .single();

    if (error || !data) return null;

    logInfo(`[INSTRUMENT-RESOLVER] ✅ Loaded from DB cache: ${data.futures_key} | Expiry: ${data.expiry} | Lot: ${data.lot_size}`);
    return {
      futuresKey: data.futures_key,
      lotSize: data.lot_size,
      expiry: data.expiry,
    };
  } catch (err: any) {
    logWarn(`[INSTRUMENT-RESOLVER] DB cache read failed: ${err.message}`);
    return null;
  }
}

/**
 * Tier 2: Download and resolve inline from Upstox instrument master.
 * Only used as a fallback when DB cache is unavailable.
 */
async function resolveFromNetwork(): Promise<ResolvedInstrument> {
  logWarn('[INSTRUMENT-RESOLVER] DB cache miss. Falling back to inline Upstox download...');
  const res = await fetch(INSTRUMENTS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} from Upstox instruments API`);

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const decompressed = await new Promise<Buffer>((resolve, reject) => {
    zlib.gunzip(buffer, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  const instruments: UpstoxInstrument[] = JSON.parse(decompressed.toString('utf-8'));
  const todayMidnight = new Date(todayISO() + 'T00:00:00.000Z').getTime();

  const niftyFutures = instruments
    .filter(i =>
      i.instrument_type === 'FUT' &&
      i.name === 'NIFTY' &&
      new Date(i.expiry).getTime() >= todayMidnight
    )
    .sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());

  if (niftyFutures.length === 0) {
    throw new Error('No active NIFTY futures contracts found in instrument master');
  }

  const frontMonth = niftyFutures[0];
  logInfo(`[INSTRUMENT-RESOLVER] ✅ Resolved inline: ${frontMonth.instrument_key} | Expiry: ${frontMonth.expiry} | Lot: ${frontMonth.lot_size}`);

  return {
    futuresKey: frontMonth.instrument_key,
    lotSize: frontMonth.lot_size,
    expiry: frontMonth.expiry,
  };
}

/**
 * Resolves the NIFTY front-month futures instrument key.
 *
 * Call once on daemon boot. Result is held in-memory for the session.
 * On monthly rollover, a daemon restart auto-refreshes via DB or network.
 *
 * @returns The instrument key string, e.g. 'NSE_FO|NIFTY25JULFUT'
 */
export async function resolveNiftyFuturesKey(): Promise<string> {
  if (_cached) return _cached.futuresKey;

  logInfo('[INSTRUMENT-RESOLVER] Resolving NIFTY Futures instrument...');

  try {
    // Tier 1: DB cache (populated by cron-prewarmer.ts at 07:55 IST)
    const fromDB = await resolveFromDB();
    if (fromDB) {
      _cached = fromDB;
      return _cached.futuresKey;
    }

    // Tier 2: Inline network download (fallback only)
    _cached = await resolveFromNetwork();
    return _cached.futuresKey;

  } catch (err: any) {
    logError(`[INSTRUMENT-RESOLVER] ❌ Both resolution tiers failed: ${err.message}`);
    // Hard fallback — update monthly if both tiers are structurally broken
    const fallback = 'NSE_FO|NIFTY25JULFUT';
    logWarn(`[INSTRUMENT-RESOLVER] Using hardcoded emergency fallback: ${fallback}. Update before next session!`);
    return fallback;
  }
}

/** Returns the cached lot size. Call after resolveNiftyFuturesKey(). */
export function getCachedLotSize(): number {
  return _cached?.lotSize ?? 75;
}

/** Clears the in-memory cache — useful to force a re-resolve mid-session */
export function clearInstrumentCache(): void {
  _cached = null;
  logInfo('[INSTRUMENT-RESOLVER] Cache cleared. Will re-resolve on next call.');
}
