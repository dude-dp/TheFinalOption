// ============================================
// MTF Screener — The Producer (Cron Trigger)
// ============================================
// Fires every 15/30m during market hours.
// Sole job: fetch watchlist → push to MTF_QUEUE.
// The Consumer handles all heavy computation.
// ============================================

import type { Env, MTFQueueMessage } from './lib/types';
import { createClient } from '@supabase/supabase-js';
import { logInfo, logError, logWarn } from './lib/logger';
import { getTodayDateStr } from './lib/time';
import { processSingleInstrument, upsertToSupabase } from './queue';

// ============================================================
// MARKET HOURS GATE
// IST = UTC+5:30. Market: 09:15–15:30 IST = 03:45–10:00 UTC
// We allow a 15-minute buffer on each side.
// ============================================================

function isMarketHours(): boolean {
  const now = new Date();
  const utcHour   = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcTotal  = utcHour * 60 + utcMinute;

  // 03:30 UTC (09:00 IST) to 10:15 UTC (15:45 IST)
  return utcTotal >= 3 * 60 + 30 && utcTotal <= 10 * 60 + 15;
}

// ============================================================
// ACCESS TOKEN RESOLVER
// Primary: Cloudflare KV (fast, cached by daemon OAuth flow)
// Fallback: Supabase system_state table
// ============================================================

export async function resolveAccessToken(env: Env): Promise<string | null> {
  // 1. Try KV first (O(1) latency)
  const kvToken = await env.TRADING_KV.get('upstox_access_token');
  if (kvToken) return kvToken;

  // 2. Fall back to Supabase system_state
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/system_state?id=eq.1&select=upstox_access_token`,
      {
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        }
      }
    );
    if (res.ok) {
      const rows = await res.json() as any[];
      return rows?.[0]?.upstox_access_token ?? null;
    }
  } catch {/* fall through */}

  return null;
}

const DEFAULT_WATCHLIST = [
  { instrument_token: 'NSE_EQ|INE002A01018', tradingsymbol: 'RELIANCE', sector: 'ENERGY', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE467B01029', tradingsymbol: 'TCS', sector: 'IT', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE009A01021', tradingsymbol: 'INFY', sector: 'IT', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE040A01034', tradingsymbol: 'HDFCBANK', sector: 'BANKING', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE090A01021', tradingsymbol: 'ICICIBANK', sector: 'BANKING', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE155A01022', tradingsymbol: 'TATAMOTORS', sector: 'AUTO', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE062A01020', tradingsymbol: 'SBIN', sector: 'BANKING', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE018A01030', tradingsymbol: 'LTIM', sector: 'IT', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE397D01024', tradingsymbol: 'BHARTIARTL', sector: 'TELECOM', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE238A01034', tradingsymbol: 'AXISBANK', sector: 'BANKING', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE154A01025', tradingsymbol: 'ITC', sector: 'FMCG', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE585B01010', tradingsymbol: 'MARUTI', sector: 'AUTO', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE044A01036', tradingsymbol: 'SUNPHARMA', sector: 'PHARMA', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE280A01028', tradingsymbol: 'TITAN', sector: 'CONSUMER', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE081A01012', tradingsymbol: 'TATASTEEL', sector: 'METALS', mtf_bracket: 3.5 },
  { instrument_token: 'NSE_EQ|INE481G01011', tradingsymbol: 'ULTRACEMCO', sector: 'CEMENT', mtf_bracket: 3.5 }
];

/**
 * Archives current rows from mtf_screened_stocks into mtf_suggestions_history
 * and clears mtf_screened_stocks so only fresh setups from the new scan run remain.
 */
async function rotateAndClearOldSetups(env: Env): Promise<void> {
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    // 1. Fetch current active setups
    const { data: oldRows, error: fetchErr } = await supabase
      .from('mtf_screened_stocks')
      .select('*');

    if (!fetchErr && oldRows && oldRows.length > 0) {
      logInfo(env, `[PRODUCER] Archiving ${oldRows.length} old setups before new scan...`);
      
      // 2. Push old setups to Supabase mtf_suggestions_history
      try {
        await supabase
          .from('mtf_suggestions_history')
          .insert(oldRows);
      } catch {/* non-critical */}

      // 3. Archive into D1 history table
      for (const row of oldRows) {
        try {
          await env.TRADING_DB.prepare(
            `INSERT INTO mtf_suggestions_history 
             (instrument_token, tradingsymbol, sector, current_price, mtf_margin_multiplier, distance_from_vwap_pct, rsi_14, macd_value, macd_signal, adx_trend, rvol, atr_value, suggested_sl, conviction, ai_catalyst, catalyst_sentiment, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            row.instrument_token || '', row.tradingsymbol || '', row.sector || 'EQUITY', row.current_price || 0,
            row.mtf_margin_multiplier || 3.5, row.distance_from_vwap_pct || 0, row.rsi_14 || 50,
            row.macd_value || 0, row.macd_signal || 'BULLISH', row.adx_trend || 0, row.rvol || 1,
            row.atr_value || 0, row.suggested_sl || 0, row.conviction || 'NORMAL',
            row.ai_catalyst || null, row.catalyst_sentiment || 'BULLISH',
            row.updated_at || new Date().toISOString()
          ).run();
        } catch {/* skip row error */}
      }

      // 4. Clear active mtf_screened_stocks so new scan starts fresh
      const { error: deleteErr } = await supabase
        .from('mtf_screened_stocks')
        .delete()
        .not('tradingsymbol', 'is', null);

      if (deleteErr) {
        logWarn(env, `[PRODUCER] Clear mtf_screened_stocks warning: ${deleteErr.message}`);
      } else {
        logInfo(env, '[PRODUCER] Active mtf_screened_stocks table rotated & cleared cleanly.');
      }
    }
  } catch (err: any) {
    logError(env, `[PRODUCER] Setup rotation error: ${err.message}`);
  }
}

// ============================================================
// MAIN SCREENER HANDLER (100% Direct Supabase Pipeline)
// Called by: export default → scheduled() or POST/GET /api/mtf-screener/trigger
// ============================================================

export async function handleScheduled(env: Env, forceRun = false, offset = 0): Promise<void> {
  logInfo(env, `[SCREENER] ${forceRun ? 'On-demand/Manual' : 'Cron'} triggered — booting direct MTF Screener pipeline (offset ${offset})...`);

  // 1. Market hours gate (bypassed if forceRun is true or offset > 0)
  if (!forceRun && offset === 0 && !isMarketHours()) {
    logInfo(env, '[SCREENER] Outside market hours. Skipping scan.');
    return;
  }

  // 2. Resolve Upstox access token FIRST
  const accessToken = await resolveAccessToken(env);
  if (!accessToken) {
    logError(env, '[SCREENER] No Upstox access token found in KV or Supabase. Aborting scan.');
    return;
  }

  // 3. Fetch watchlist instruments from Supabase in chunks of 40 (to satisfy Cloudflare Worker subrequest quota)
  let instruments: any[] = [];
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/mtf_instrument_master?is_active=eq.true&select=instrument_token,tradingsymbol,sector,mtf_bracket&order=liquidity_tier.asc,tradingsymbol.asc&limit=40&offset=${offset}`,
      {
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        }
      }
    );

    if (res.ok) {
      instruments = await res.json() as any[];
    }
  } catch (err: any) {
    logError(env, `[SCREENER] Primary instrument fetch error (offset ${offset}): ${err.message}`);
  }

  // Fallback 1: Use default watchlist if Supabase query returned 0 at offset 0
  if ((!instruments || instruments.length === 0) && offset === 0) {
    logWarn(env, '[SCREENER] Supabase instrument table empty/unreachable. Falling back to default high-volume watchlist.');
    instruments = DEFAULT_WATCHLIST;
  }

  if (!instruments || instruments.length === 0) {
    logInfo(env, `[SCREENER] Full scan complete. No more instruments found at offset ${offset}.`);
    return;
  }

  logInfo(env, `[SCREENER] Chunk offset ${offset}: Loaded ${instruments.length} instruments from Supabase. Direct scanning candles...`);

  // 4. Archive old active setups ONLY on the initial chunk (offset 0)
  if (offset === 0) {
    await rotateAndClearOldSetups(env);
  }

  // 5. Direct parallel execution (batch chunks of 5 instruments)
  const CONCURRENCY = 5;
  let chunkPassingCount = 0;

  for (let i = 0; i < instruments.length; i += CONCURRENCY) {
    const batch = instruments.slice(i, i + CONCURRENCY);
    const promises = batch.map(inst => processSingleInstrument(env, {
      token: inst.instrument_token,
      symbol: inst.tradingsymbol,
      sector: inst.sector || 'EQUITY',
      margin: Number(inst.mtf_bracket) || 3.5
    }, accessToken));

    const results = await Promise.all(promises);
    const batchSetups = results.filter((res): res is any => res !== null);

    if (batchSetups.length > 0) {
      chunkPassingCount += batchSetups.length;
      // Upsert batch results immediately so setups populate Supabase and dashboard in real-time
      await upsertToSupabase(env, batchSetups);
    }
  }

  logInfo(env, `[SCREENER] Chunk offset ${offset} complete: ${chunkPassingCount} setups found in this chunk.`);

  // 6. Automatically chain next chunk if 40 instruments were processed
  if (instruments.length === 40) {
    const nextOffset = offset + 40;
    logInfo(env, `[SCREENER] Chaining next scan chunk at offset ${nextOffset}...`);
    try {
      const triggerUrl = `https://thefinaloption.thefinaloptionautomation.workers.dev/api/mtf-screener/trigger?offset=${nextOffset}&forceRun=${forceRun ? 'true' : 'false'}`;
      await fetch(triggerUrl, {
        headers: {
          'Authorization': `Basic ${btoa('vdineshprabu:Healthywealth007#')}`
        }
      });
    } catch (err: any) {
      logWarn(env, `[SCREENER] Failed to trigger next scan chunk at offset ${nextOffset}: ${err.message}`);
    }
  } else {
    logInfo(env, `[SCREENER] ✅ FULL SCAN COMPLETED across all instruments in Supabase master table!`);
  }

  // 7. Update last_scan_time in system_controls
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/system_controls`, {
      method: 'POST',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify([{ id: 1, last_scan_time: new Date().toISOString() }])
    });
  } catch {/* non-critical */}
}

// ============================================================
// CONFIG SNAPSHOT (runs at 30 18 * * * = midnight IST)
// ============================================================

export async function takeConfigSnapshot(env: Env): Promise<void> {
  const today = getTodayDateStr();
  try {
    const existing = await env.TRADING_DB.prepare(
      'SELECT id FROM bot_configuration_history WHERE snapshot_date = ? LIMIT 1'
    ).bind(today).first();

    if (existing) return; // Idempotent — only one snapshot per day

    await env.TRADING_DB.prepare(
      `INSERT INTO bot_configuration_history (snapshot_date, config_key, config_value)
       SELECT ?, config_key, config_value FROM bot_configuration`
    ).bind(today).run();

    logInfo(env, `[CONFIG] Daily config snapshot saved for ${today}`);
  } catch (err: any) {
    logError(env, `[CONFIG] Snapshot failed: ${err.message}`);
  }
}
