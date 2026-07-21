// ============================================
// Scheduled Tasks & Prewarmers (Now running within daemon)
// ============================================

import 'dotenv/config';
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import zlib from 'zlib';
import { logInfo, logWarn, logError } from './logger.js';
import { AIBenchmarker } from './ai/benchmark.js';

const INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz';

interface UpstoxInstrument {
  instrument_key: string;
  name: string;
  instrument_type: string;
  expiry: string; // 'YYYY-MM-DD'
  lot_size: number;
}

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

function todayISO(): string {
  return new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

async function runUpstoxPrewarmer() {
  try {
    const today = todayISO();
    logInfo(`[PREWARMER] ${new Date().toISOString()} — Starting instrument cache prewarm for ${today}`);

    // ── Step 1: Download + Decompress instrument master ──────────────────
    logInfo('[PREWARMER] Downloading Upstox NSE F&O instrument master...');
    const res = await fetch(INSTRUMENTS_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from Upstox instruments API — aborting prewarm`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(buffer, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const instruments: UpstoxInstrument[] = JSON.parse(decompressed.toString('utf-8'));
    logInfo(`[PREWARMER] Downloaded ${instruments.length} instruments.`);

    // ── Step 2: Filter for NIFTY front-month futures ─────────────────────
    const now = Date.now();
    const todayMidnight = new Date(today + 'T00:00:00.000Z').getTime();

    const niftyFutures = instruments
      .filter(i =>
        i.instrument_type === 'FUT' &&
        i.name === 'NIFTY' &&
        new Date(i.expiry).getTime() >= todayMidnight // expiry >= today (rollover guard)
      )
      .sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());

    if (niftyFutures.length === 0) {
      throw new Error('[PREWARMER] ❌ No active NIFTY futures found — exchange may not have propagated rollover yet. Aborting.');
    }

    const frontMonth = niftyFutures[0];
    const expiryDate = new Date(frontMonth.expiry + 'T00:00:00.000Z');
    const daysToExpiry = Math.round((expiryDate.getTime() - now) / 86400000);

    // ── Step 3: Expiry rollover guard ────────────────────────────────────
    if (expiryDate.getTime() < todayMidnight) {
      throw new Error(`[PREWARMER] ❌ Resolved contract ${frontMonth.instrument_key} has already expired (${frontMonth.expiry}). Refusing to cache.`);
    }

    logInfo(`[PREWARMER] ✅ Resolved: ${frontMonth.instrument_key} | Expiry: ${frontMonth.expiry} (${daysToExpiry} days) | Lot: ${frontMonth.lot_size}`);

    // ── Step 4: Upsert to instrument_cache ───────────────────────────────
    const { error: upsertError } = await supabase
      .from('instrument_cache')
      .upsert({
        date: today,
        futures_key: frontMonth.instrument_key,
        lot_size: frontMonth.lot_size,
        expiry: frontMonth.expiry,
      }, { onConflict: 'date' });

    if (upsertError) {
      throw new Error(`[PREWARMER] ❌ Supabase upsert failed: ${upsertError.message}`);
    }

    logInfo(`[PREWARMER] ✅ instrument_cache row upserted for ${today}.`);

    // ── Step 5: Garbage collect rows older than 7 days ───────────────────
    const cutoffDate = new Date(now - 7 * 86400000).toISOString().split('T')[0];
    const { error: gcError, count } = await supabase
      .from('instrument_cache')
      .delete({ count: 'exact' })
      .lt('date', cutoffDate);

    if (gcError) {
      logWarn(`[PREWARMER] GC warning: ${gcError.message}`);
    } else {
      logInfo(`[PREWARMER] GC: removed ${count ?? 0} stale rows (before ${cutoffDate}).`);
    }

    // ── Step 6: Log success event to Supabase ────────────────────────────
    await supabase.from('system_events').insert({
      event_type: 'prewarmer_success',
      payload: {
        date: today,
        futures_key: frontMonth.instrument_key,
        expiry: frontMonth.expiry,
        lot_size: frontMonth.lot_size,
        days_to_expiry: daysToExpiry,
      }
    }).then(({ error }) => {
      if (error) logWarn(`[PREWARMER] Event log warning: ${error.message}`);
    });

    logInfo(`[PREWARMER] ✅ Prewarm complete. Daemon will read ${frontMonth.instrument_key} from DB on next boot.`);
  } catch (err: any) {
    logError(`[PREWARMER] ❌ FATAL: ${err.message}`);
  }
}

export function initializeCronJobs() {
  logInfo('[CRON] Initializing automated schedules...');

  // Existing pre-warmer cron jobs... run at 07:55 IST Mon-Fri
  cron.schedule('55 7 * * 1-5', async () => {
    logInfo('[CRON] Firing scheduled Upstox Prewarmer...');
    await runUpstoxPrewarmer();
  }, {
    timezone: "Asia/Kolkata"
  });

  // NEW: AI Benchmarking Job at 1:00 AM IST every day
  cron.schedule('0 1 * * *', async () => {
    logInfo('[CRON] Firing scheduled AI Benchmark...');
    await AIBenchmarker.runDailyBenchmark();
  }, {
    timezone: "Asia/Kolkata"
  });
}
