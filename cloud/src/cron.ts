// ============================================
// MTF Screener — The Producer (Cron Trigger)
// ============================================
// Fires every 15/30m during market hours.
// Sole job: fetch watchlist → push to MTF_QUEUE.
// The Consumer handles all heavy computation.
// ============================================

import type { Env, MTFQueueMessage } from './lib/types';
import { logInfo, logError, logWarn } from './lib/logger';
import { getTodayDateStr } from './lib/time';

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

async function resolveAccessToken(env: Env): Promise<string | null> {
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
    // 1. Ensure D1 history table exists
    try {
      await env.TRADING_DB.prepare(
        `CREATE TABLE IF NOT EXISTS mtf_suggestions_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instrument_token TEXT,
          tradingsymbol TEXT,
          sector TEXT,
          current_price REAL,
          mtf_margin_multiplier REAL,
          distance_from_vwap_pct REAL,
          rsi_14 REAL,
          macd_value REAL,
          macd_signal TEXT,
          adx_trend REAL,
          rvol REAL,
          atr_value REAL,
          suggested_sl REAL,
          conviction TEXT,
          ai_catalyst TEXT,
          catalyst_sentiment TEXT,
          updated_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`
      ).run();
    } catch (e: any) {
      logWarn(env, `[PRODUCER] D1 table creation warning: ${e.message}`);
    }

    // 2. Fetch current active setups
    const fetchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/mtf_screened_stocks?select=*`,
      {
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        }
      }
    );

    if (fetchRes.ok) {
      const oldRows = await fetchRes.json() as any[];
      if (oldRows && oldRows.length > 0) {
        logInfo(env, `[PRODUCER] Archiving ${oldRows.length} old setups before new scan...`);
        
        // 3. Try pushing old setups to Supabase mtf_suggestions_history (if table exists)
        try {
          await fetch(`${env.SUPABASE_URL}/rest/v1/mtf_suggestions_history`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates',
            },
            body: JSON.stringify(oldRows),
          });
        } catch {/* non-critical if Supabase table created on-demand */}

        // 4. Always archive into D1 history table
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

        // 5. Clear active mtf_screened_stocks so new scan starts fresh
        const deleteRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/mtf_screened_stocks?tradingsymbol=neq.null`,
          {
            method: 'DELETE',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            }
          }
        );
        if (deleteRes.ok) {
          logInfo(env, '[PRODUCER] Active mtf_screened_stocks table rotated & cleared cleanly.');
        }
      }
    }
  } catch (err: any) {
    logError(env, `[PRODUCER] Setup rotation error: ${err.message}`);
  }
}

// ============================================================
// MAIN PRODUCER HANDLER
// Called by: export default → scheduled() or POST /api/mtf-screener/trigger
// ============================================================

export async function handleScheduled(env: Env, forceRun = false): Promise<void> {
  logInfo(env, `[PRODUCER] ${forceRun ? 'On-demand/Manual' : 'Cron'} triggered — booting MTF Screener pipeline...`);

  // 1. Market hours gate (bypassed if forceRun is true)
  if (!forceRun && !isMarketHours()) {
    logInfo(env, '[PRODUCER] Outside market hours. Skipping scan.');
    return;
  }

  // 2. Rotate and archive old active setups before enqueuing fresh scan run
  await rotateAndClearOldSetups(env);

  // 2. Resolve Upstox access token
  const accessToken = await resolveAccessToken(env);
  if (!accessToken) {
    logError(env, '[PRODUCER] No Upstox access token found in KV or Supabase. Aborting scan.');
    return;
  }

  // 3. Fetch high-liquidity watchlist from Supabase
  let instruments: any[] = [];
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/mtf_instrument_master?liquidity_tier=eq.HIGH&is_active=eq.true&select=instrument_token,tradingsymbol,sector,mtf_bracket`,
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
    logError(env, `[PRODUCER] Primary instrument fetch error: ${err.message}`);
  }

  // Fallback 1: Query all active instruments if tier filter yields 0
  if (!instruments || instruments.length === 0) {
    try {
      const resFallback = await fetch(
        `${env.SUPABASE_URL}/rest/v1/mtf_instrument_master?select=instrument_token,tradingsymbol,sector,mtf_bracket&limit=300`,
        {
          headers: {
            'apikey':        env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          }
        }
      );
      if (resFallback.ok) {
        instruments = await resFallback.json() as any[];
      }
    } catch {/* fall through */}
  }

  // Fallback 2: Use default watchlist if Supabase table is empty
  if (!instruments || instruments.length === 0) {
    logWarn(env, '[PRODUCER] Supabase instrument table empty/unreachable. Falling back to default high-volume watchlist.');
    instruments = DEFAULT_WATCHLIST;
  }

  logInfo(env, `[PRODUCER] Loaded ${instruments.length} instruments. Dispatching to queue...`);

  // 4. Chunk into batches of 10 and send to MTF_QUEUE
  const BATCH_SIZE = 10;
  let totalBatches = 0;

  for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
    const chunk = instruments.slice(i, i + BATCH_SIZE);

    const messages: MessageSendRequest<MTFQueueMessage>[] = chunk.map(inst => ({
      body: {
        token:       inst.instrument_token,
        symbol:      inst.tradingsymbol,
        sector:      inst.sector     || 'EQUITY',
        margin:      Number(inst.mtf_bracket) || 3.5,
        accessToken, // Embed token per-scan so consumer workers are stateless
      }
    }));

    try {
      await env.MTF_QUEUE.sendBatch(messages);
      totalBatches++;
    } catch (err: any) {
      logError(env, `[PRODUCER] sendBatch failed at offset ${i}: ${err.message}`);
    }
  }

  logInfo(env, `[PRODUCER] Dispatched ${totalBatches} batches (${instruments.length} stocks) to MTF_QUEUE.`);

  // 5. Update last_scan_time in system_controls
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
