// ============================================
// MTF Screener — The Consumer (Queue Worker)
// ============================================
// CF auto-scales up to 5 concurrent instances.
// Each instance processes a batch of ≤10 stocks.
// No sleep() needed — queue delivery IS the throttle.
// ============================================

import type { Env, MTFQueueMessage, MTFSetupData } from './lib/types';
import { detect30mSignals, check3HConviction, resolvePrimarySignal } from './lib/mtf-screener-logic';
import { fetchScreenerCandles } from './lib/upstox';

// ============================================================
// DISCORD SNIPER ALERT
// Fires only for HIGH conviction ZERO_LINE_CROSS setups
// ============================================================

async function sendDiscordAlert(env: Env, stock: MTFSetupData): Promise<void> {
  if (!env.DISCORD_MTF_WEBHOOK) return;

  const embed = {
    embeds: [{
      title: `🚨 MTF Breakout: ${stock.tradingsymbol}`,
      color: 3447003, // Institutional blue
      url:   `https://in.tradingview.com/chart/?symbol=NSE:${stock.tradingsymbol}`,
      fields: [
        { name: 'LTP',            value: `₹${stock.current_price}`,               inline: true  },
        { name: 'Leverage',       value: `${stock.mtf_margin_multiplier}x`,        inline: true  },
        { name: 'Sector',         value: `${stock.sector}`,                        inline: true  },
        { name: 'Signal',         value: `**${stock.macd_signal}**`,               inline: true  },
        { name: 'VWAP Ext.',      value: `${stock.distance_from_vwap_pct}%`,       inline: true  },
        { name: 'RVOL',           value: `${stock.rvol}x`,                         inline: true  },
        { name: 'RSI (14)',       value: `${stock.rsi_14}`,                         inline: true  },
        { name: 'ADX',            value: `${stock.adx_trend}`,                     inline: true  },
        { name: 'Target SL',      value: `₹${stock.suggested_sl} (2×ATR)`,         inline: false },
      ],
      footer:    { text: 'TheFinalOption • MTF Quant Screener' },
      timestamp: new Date().toISOString(),
    }]
  };

  try {
    await fetch(env.DISCORD_MTF_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(embed),
    });
  } catch {/* non-critical */}
}

// ============================================================
// SUPABASE BULK UPSERT
// Uses the REST API with Prefer: resolution=merge-duplicates
// ============================================================

async function upsertToSupabase(env: Env, rows: MTFSetupData[]): Promise<void> {
  if (rows.length === 0) return;

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/mtf_screened_stocks`, {
    method: 'POST',
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[CONSUMER] Supabase upsert failed (${res.status}): ${body}`);
  }
}

// ============================================================
// MAIN QUEUE HANDLER
// Called by: export default → queue()
// ============================================================

export async function handleQueue(
  batch: MessageBatch<MTFQueueMessage>,
  env: Env
): Promise<void> {
  const upsertPayloads: MTFSetupData[] = [];

  for (const msg of batch.messages) {
    const { token, symbol, sector, margin, accessToken } = msg.body;

    try {
      // STEP A: Fetch 30-minute candles (5+ trading days to ensure >= 65 candles)
      const candles30m = await fetchScreenerCandles(accessToken, token, '30minute', 10);

      if (candles30m.length < 65) {
        msg.ack(); // Not enough data — skip silently
        continue;
      }

      // STEP B: Run the quantitative gatekeeper
      const result = detect30mSignals(candles30m);
      if (!result) {
        msg.ack(); // No setup — skip
        continue;
      }

      // STEP C: 3H / Daily conviction check (lazy evaluation — only fires if 30m passes)
      const dailyCandles  = await fetchScreenerCandles(accessToken, token, 'day', 40);
      const is3HAligned   = check3HConviction(dailyCandles);
      const conviction    = is3HAligned ? 'HIGH' : 'NORMAL';

      // STEP D: Resolve primary signal label
      const primarySignal = resolvePrimarySignal(result.signals);

      // STEP E: Build setup record
      const setupData: MTFSetupData = {
        instrument_token:        token,
        tradingsymbol:           symbol,
        sector,
        current_price:           Number(result.price.toFixed(2)),
        mtf_margin_multiplier:   margin,
        distance_from_vwap_pct:  Number(result.vwapDist.toFixed(2)),
        rsi_14:                  Number(result.rsi.toFixed(2)),
        macd_value:              Number(result.macdValue.toFixed(4)),
        macd_signal:             primarySignal,
        adx_trend:               Number(result.adx.toFixed(2)),
        rvol:                    Number(result.rvol.toFixed(2)),
        atr_value:               Number(result.atr.toFixed(2)),
        suggested_sl:            result.suggestedSL,
        conviction,
        updated_at:              new Date().toISOString(),
      };

      upsertPayloads.push(setupData);

      console.log(
        `[CONSUMER] ✅ ${symbol}: ${primarySignal} (${conviction}) ` +
        `MACD=${result.macdValue.toFixed(3)} RSI=${result.rsi.toFixed(1)} ADX=${result.adx.toFixed(1)}`
      );

      // STEP F: Discord sniper — only for HIGH conviction zero-line events
      const isTopTier =
        conviction === 'HIGH' &&
        (result.signals.includes('ZERO_LINE_CROSS') || result.signals.includes('SIGNAL_LINE_CROSS'));

      if (isTopTier) {
        sendDiscordAlert(env, setupData).catch(err =>
          console.error(`[CONSUMER] Discord alert error for ${symbol}: ${err.message}`)
        );
      }

      msg.ack();

    } catch (err: any) {
      console.error(`[CONSUMER] Error processing ${symbol}: ${err.message}`);
      msg.retry(); // Back to queue — CF will retry up to max_retries
    }
  }

  // STEP G: Bulk upsert all passing setups from this batch in one shot
  await upsertToSupabase(env, upsertPayloads);

  if (upsertPayloads.length > 0) {
    console.log(`[CONSUMER] Batch complete: ${upsertPayloads.length} setups upserted to Supabase.`);
  }
}
