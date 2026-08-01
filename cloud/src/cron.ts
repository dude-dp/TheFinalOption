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

// ============================================================
// MAIN PRODUCER HANDLER
// Called by: export default → scheduled()
// ============================================================

export async function handleScheduled(env: Env): Promise<void> {
  logInfo(env, '[PRODUCER] Cron triggered — booting MTF Screener pipeline...');

  // 1. Market hours gate
  if (!isMarketHours()) {
    logInfo(env, '[PRODUCER] Outside market hours. Skipping scan.');
    return;
  }

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

    if (!res.ok) {
      logError(env, `[PRODUCER] Supabase instrument query failed (${res.status})`);
      return;
    }

    instruments = await res.json() as any[];
  } catch (err: any) {
    logError(env, `[PRODUCER] Instrument fetch error: ${err.message}`);
    return;
  }

  if (!instruments || instruments.length === 0) {
    logWarn(env, '[PRODUCER] Instrument master is empty. Run instrument sync first.');
    return;
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
