// ============================================
// MTF Screener — The Consumer (Queue Worker)
// ============================================
// CF auto-scales up to 5 concurrent instances.
// Each instance processes a batch of ≤10 stocks.
// No sleep() needed — queue delivery IS the throttle.
// ============================================

import type { Env, MTFSetupData } from './lib/types';
import { createClient } from '@supabase/supabase-js';
import { logInfo, logError } from './lib/logger';
import { detect30mSignals, check3HConviction, resolvePrimarySignal } from './lib/mtf-screener-logic';
import { fetchScreenerCandles } from './lib/upstox';
import { generateStockCatalyst } from './lib/ai-catalyst';

// ============================================================
// DISCORD SNIPER ALERT
// Fires for HIGH conviction setups & enriched with AI Catalyst
// ============================================================

async function sendDiscordAlert(env: Env, stock: MTFSetupData): Promise<void> {
  if (!env.DISCORD_MTF_WEBHOOK) return;

  const sentimentColor =
    stock.catalyst_sentiment === 'BEARISH' ? 15548997 : // Crimson
    stock.catalyst_sentiment === 'BULLISH' ? 1097865  : // Emerald
    6514930; // Indigo

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'LTP',            value: `₹${stock.current_price}`,               inline: true  },
    { name: 'Leverage',       value: `${stock.mtf_margin_multiplier}x`,        inline: true  },
    { name: 'Sector',         value: `${stock.sector}`,                        inline: true  },
    { name: 'Setup',          value: `**${stock.macd_signal}**`,               inline: true  },
    { name: 'VWAP Ext.',      value: `${stock.distance_from_vwap_pct}%`,       inline: true  },
    { name: 'RVOL',           value: `${stock.rvol}x`,                         inline: true  },
    { name: 'RSI (14)',       value: `${stock.rsi_14}`,                         inline: true  },
    { name: 'ADX',            value: `${stock.adx_trend}`,                     inline: true  },
    { name: 'Target SL',      value: `₹${stock.suggested_sl} (2×ATR)`,         inline: true  },
  ];

  if (stock.ai_catalyst) {
    fields.push({
      name: `🤖 AI Catalyst (${stock.catalyst_sentiment || 'BULLISH'})`,
      value: `> ${stock.ai_catalyst}`,
      inline: false
    });
  }

  const embed = {
    embeds: [{
      title: `🚨 MTF Quant Setup: ${stock.tradingsymbol} [${stock.conviction} CONVICTION]`,
      color: sentimentColor,
      url:   `https://in.tradingview.com/chart/?symbol=NSE:${stock.tradingsymbol}`,
      fields,
      footer:    { text: 'TheFinalOption • MTF Quant Screener & AI Confluence' },
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

export async function processSingleInstrument(
  env: Env,
  inst: { token: string; symbol: string; sector: string; margin: number },
  accessToken: string
): Promise<MTFSetupData | null> {
  const { token, symbol, sector, margin } = inst;
  try {
    // STEP A: Fetch 30-minute candles
    const candles30m = await fetchScreenerCandles(accessToken, token, '30minute', 10);
    if (candles30m.length < 65) return null;

    // STEP B: Quantitative gatekeeper
    const result = detect30mSignals(candles30m);
    if (!result) return null;

    // STEP C: 3H / Daily conviction check
    const dailyCandles = await fetchScreenerCandles(accessToken, token, 'day', 40);
    const is3HAligned  = check3HConviction(dailyCandles);
    const conviction   = is3HAligned ? 'HIGH' : 'NORMAL';

    // STEP D: Resolve primary signal label
    const primarySignal = resolvePrimarySignal(result.signals);

    // STEP E: AI Catalyst Confluence
    let aiCatalystSummary = '';
    let aiCatalystSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' = 'BULLISH';

    const isTopTier =
      conviction === 'HIGH' ||
      result.signals.includes('TIGHT_BASE_SQUEEZE') ||
      result.signals.includes('VOL_EXHAUSTION') ||
      result.signals.includes('PERFECT_TREND_STACK') ||
      result.signals.includes('SUPPORT_DIP_BUY') ||
      result.signals.includes('ZERO_LINE_CROSS');

    if (isTopTier) {
      try {
        const aiResult = await generateStockCatalyst(env, symbol, {
          price: result.price,
          sector,
          primarySignal,
          macdValue: result.macdValue,
          rsi: result.rsi,
          adx: result.adx,
          rvol: result.rvol,
          atr: result.atr,
          vwapDist: result.vwapDist,
          conviction
        });
        aiCatalystSummary = aiResult.catalyst;
        aiCatalystSentiment = aiResult.sentiment;
      } catch (err: any) {
        console.warn(`[CONSUMER] AI Catalyst fetch non-fatal error for ${symbol}: ${err?.message}`);
      }
    }

    // STEP F: Build setup record
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
      ai_catalyst:             aiCatalystSummary || undefined,
      catalyst_sentiment:      aiCatalystSentiment,
      updated_at:              new Date().toISOString(),
    };

    console.log(
      `[CONSUMER] ✅ ${symbol}: ${primarySignal} (${conviction}) ` +
      `MACD=${result.macdValue.toFixed(3)} RSI=${result.rsi.toFixed(1)} ADX=${result.adx.toFixed(1)}`
    );

    // STEP G: Discord sniper
    if (isTopTier) {
      sendDiscordAlert(env, setupData).catch(err =>
        console.error(`[CONSUMER] Discord alert error for ${symbol}: ${err.message}`)
      );
    }

    return setupData;
  } catch (err: any) {
    console.error(`[CONSUMER] Error processing ${symbol}: ${err.message}`);
    return null;
  }
}

export async function upsertToSupabase(env: Env, rows: MTFSetupData[]): Promise<void> {
  if (rows.length === 0) return;

  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const { error } = await supabase
      .from('mtf_screened_stocks')
      .insert(rows);

    if (error) {
      console.error(`[CONSUMER] Supabase insert failed: ${error.message}`);
      logError(env, `[CONSUMER] Supabase insert failed: ${error.message}`);
    } else {
      console.log(`[CONSUMER] ✅ Successfully inserted ${rows.length} quantitative setups to Supabase mtf_screened_stocks.`);
      logInfo(env, `[CONSUMER] ✅ Successfully inserted ${rows.length} quantitative setups to Supabase mtf_screened_stocks.`);
    }
  } catch (err: any) {
    console.error(`[CONSUMER] Supabase insert exception: ${err.message}`);
    logError(env, `[CONSUMER] Supabase insert exception: ${err.message}`);
  }
}


