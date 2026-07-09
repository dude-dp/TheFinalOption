// ============================================
// Cron Worker — The Brain
// Executes every minute during market hours
// Evaluates MACD, generates signals, queues orders
// ============================================

import type { Env, BotState, BotConfig, OrderPayload, SignalType } from './lib/types';
import { KV_KEYS } from './lib/types';
import { getLatestMACDValues, detectZeroCrossover } from './lib/macd';
import { calculateATM, selectStrike, shouldRollExpiry, getNearestWeeklyExpiry } from './lib/strike';
import { calculateLots, lotsToQuantity } from './lib/lot-sizing';
import { isMarketOpen, isSquareOffTime, isEODSummaryTime, isPreMarketWarmup, getTodayDateStr, generateCorrelationId } from './lib/time';
import { fetchNiftyCandles, getOptionChain, getFundsAndMargin, getLTP } from './lib/upstox';
import { addPendingOrder } from './lib/orders';

// --- Config Loader ---

async function loadConfig(db: D1Database): Promise<BotConfig> {
  const rows = await db.prepare('SELECT config_key, config_value FROM bot_configuration').all();
  const map: Record<string, string> = {};
  for (const r of rows.results || []) {
    map[(r as any).config_key] = (r as any).config_value;
  }
  return {
    maxRiskPct: parseFloat(map['max_risk_pct'] || '20'),
    niftyLotSize: parseInt(map['nifty_lot_size'] || '65', 10),
    rolloverOnExpiry: map['rollover_on_expiry'] === 'true',
    defaultExpiry: map['default_expiry'] || 'weekly',
    maxStrikeLevels: parseInt(map['max_strike_levels'] || '2', 10),
    strikeInterval: parseInt(map['strike_interval'] || '50', 10),
    squareOffTime: map['square_off_time'] || '15:15',
    paperMode: map['paper_mode'] === 'true',
  };
}

// --- Bot State ---

async function getBotState(kv: KVNamespace): Promise<BotState> {
  const raw = await kv.get(KV_KEYS.BOT_STATE);
  if (!raw) {
    return {
      status: 'STOPPED',
      lastUpdated: new Date().toISOString(),
      activePosition: null,
      lockTimestamp: null,
      lastMacdLine: null,
    };
  }
  return JSON.parse(raw);
}

async function saveBotState(kv: KVNamespace, state: BotState): Promise<void> {
  state.lastUpdated = new Date().toISOString();
  await kv.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
}

// --- Telemetry Logger ---

async function logTelemetry(
  db: D1Database,
  spot: number,
  atm: number,
  macd: number,
  prevMacd: number,
  signal: SignalType,
  status: string,
  message: string | null
): Promise<void> {
  await db.prepare(
    `INSERT INTO system_telemetry (nifty_spot, atm_strike, macd_line, prev_macd_line, signal_generated, bot_status, log_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(spot, atm, macd, prevMacd, signal, status, message).run();
}

// --- Main Cron Handler ---

export async function handleScheduled(env: Env): Promise<void> {
  const config = await loadConfig(env.TRADING_DB);
  const state = await getBotState(env.TRADING_KV);

  // GATE 1: Bot must be RUNNING
  if (state.status !== 'RUNNING') {
    return;
  }

  // GATE 2: Get access token
  const accessToken = await env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
  if (!accessToken) {
    await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, 'SKIP: No Upstox access token');
    return;
  }

  // --- NEW: FETCH & CACHE AVAILABLE MARGIN ---
  if (isMarketOpen() || isPreMarketWarmup()) {
    try {
      const funds = await getFundsAndMargin(accessToken);
      await env.TRADING_KV.put(KV_KEYS.ACCOUNT_MARGIN, JSON.stringify({
        ...funds,
        timestamp: Date.now()
      }));
    } catch (e: any) {
      // Fail silently to avoid interrupting trade logic
    }
  }

  // PRE-MARKET: Update lot size from instrument master
  if (isPreMarketWarmup()) {
    try {
      const today = getTodayDateStr();
      const roll = shouldRollExpiry(new Date(), config.rolloverOnExpiry);
      const expiry = getNearestWeeklyExpiry(new Date(), roll);
      const chain = await getOptionChain(accessToken, expiry);
      if (chain.length > 0 && chain[0].lotSize > 0) {
        await env.TRADING_DB.prepare(
          `UPDATE bot_configuration SET config_value = ?, updated_at = datetime('now') WHERE config_key = 'nifty_lot_size'`
        ).bind(String(chain[0].lotSize)).run();
      }
    } catch (e: any) {
      await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, `WARMUP_ERROR: ${e.message}`);
    }
    return;
  }

  // GATE 3: Market must be open
  if (!isMarketOpen()) {
    // Check for EOD summary
    if (isEODSummaryTime()) {
      try {
        await generateEODSummary(env);
      } catch (_) { /* non-critical */ }
    }
    return;
  }

  // --- MAIN TRADING LOGIC ---

  let spotPrice = 0;
  let atmStrike = 0;
  let currentMacd = 0;
  let prevMacd = 0;

  try {
    // Fetch 1-min NIFTY candles
    const today = getTodayDateStr();
    const candles = await fetchNiftyCandles(accessToken, today);

    if (candles.length < 35) {
      await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, `SKIP: Insufficient candles (${candles.length})`);
      return;
    }

    // Current spot = latest candle close
    spotPrice = candles[candles.length - 1].close;
    atmStrike = calculateATM(spotPrice, config.strikeInterval);

    // Compute MACD
    const closes = candles.map(c => c.close);
    const macdResult = getLatestMACDValues(closes);

    if (!macdResult) {
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, 0, 0, 'NONE', state.status, 'SKIP: MACD calculation failed');
      return;
    }

    currentMacd = macdResult.current;
    prevMacd = macdResult.previous;

    // ==========================================
    // RISK MANAGEMENT: 6% HARD SL & TRAILING SL
    // ==========================================
    if (state.activePosition && !state.lockTimestamp) {
      try {
        // 1. Fetch current LTP of the active option contract
        const ltpData = await getLTP(accessToken, [state.activePosition.instrumentToken]);
        const currentLTP = ltpData[state.activePosition.instrumentToken];

        if (currentLTP && state.activePosition.entryPrice) {
          const entry = state.activePosition.entryPrice;

          // 2. Track the highest price seen so far
          state.activePosition.highestPrice = Math.max(
            state.activePosition.highestPrice || entry,
            currentLTP
          );

          const peak = state.activePosition.highestPrice;

          // Calculate percentages based on premium 
          // (1:1 correlation with % return on used capital)
          const currentProfitPct = ((currentLTP - entry) / entry) * 100;
          const maxProfitPct = ((peak - entry) / entry) * 100;

          // 3. Evaluate Conditions
          // Hard SL: Price drops 6% below our initial entry
          const isHardSLHit = currentProfitPct <= -6.0;

          // Trailing SL logic
          let isTrailingSLHit = false;
          let activeTSLPrice = 0;

          // If we have hit the 6% profit milestone
          if (maxProfitPct >= 6.0) {
            // Lock in 2% at 6% profit. (Distance is always peak - 4%)
            // Example: 6% peak -> 2% SL. 7% peak -> 3% SL.
            const trailingSLPct = maxProfitPct - 4.0;
            activeTSLPrice = entry * (1 + (trailingSLPct / 100));

            // If current price falls back to or below our trailing line
            if (currentLTP <= activeTSLPrice) {
              isTrailingSLHit = true;
            }
          }

          if (isHardSLHit || isTrailingSLHit) {
            const exitReason = isHardSLHit ? 'HARD_SL_HIT_6_PERCENT' : 'TRAILING_SL_HIT';

            // Log the exact math that triggered the exit to the console/D1
            await logTelemetry(
              env.TRADING_DB,
              spotPrice, // Note: spotPrice must be available in this scope
              state.activePosition.strikePrice,
              currentMacd,
              prevMacd,
              'NONE',
              state.status,
              `EXIT: ${exitReason}. LTP: ₹${currentLTP}, Peak: ₹${peak}, Entry: ₹${entry}, TSL Line: ₹${activeTSLPrice.toFixed(2)}`
            );

            // Dispatch square off order
            await dispatchSquareOff(env, state, accessToken, config);

            // Save state and exit the cron for this minute to prevent MACD from double-triggering
            await saveBotState(env.TRADING_KV, state);
            return;
          } else {
            // If no SL is hit, we still save the state to persist the updated highestPrice
            await saveBotState(env.TRADING_KV, state);
          }
        }
      } catch (error: any) {
        console.error("Failed to fetch LTP for Risk Management check:", error);
        // Fail silently here, allowing the MACD logic below to continue as a safety net
      }
    }
    // ==========================================
    // END RISK MANAGEMENT
    // ==========================================

    // AUTO SQUARE-OFF CHECK
    if (isSquareOffTime(config.squareOffTime)) {
      if (state.activePosition) {
        await dispatchSquareOff(env, state, accessToken, config);
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, 'AUTO_SQUAREOFF: Time-based exit');
      }
      return;
    }

    // DETECT SIGNAL
    const signal = detectZeroCrossover(currentMacd, prevMacd);

    if (!signal) {
      // No crossover — update lastMacdLine and log
      state.lastMacdLine = currentMacd;
      // Only save state if MACD changed meaningfully (saves KV writes)
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, null);
      return;
    }

    // --- SIGNAL DETECTED ---

    // Check position lock and handle deadlock recovery
    if (state.lockTimestamp) {
      const lockAgeMinutes = (Date.now() - state.lockTimestamp) / 60000;
      if (lockAgeMinutes > 3) {
        state.lockTimestamp = null;
        await saveBotState(env.TRADING_KV, state);
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, `WARN: Deadlock detected (lock >3m). Cleared lock.`);
      } else {
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, 'SKIP: Position locked');
        return;
      }
    }

    // Lock position
    state.lockTimestamp = Date.now();
    await saveBotState(env.TRADING_KV, state);

    // If there's an active opposite position, square it off first
    if (state.activePosition) {
      const opposite = signal === 'BUY_CE' ? 'PE' : 'CE';
      if (state.activePosition.optionType === opposite) {
        await dispatchSquareOff(env, state, accessToken, config);
      }
    }

    // Determine expiry and strike
    const rollover = shouldRollExpiry(new Date(), config.rolloverOnExpiry);
    const expiry = getNearestWeeklyExpiry(new Date(), rollover);
    const optionType = signal === 'BUY_CE' ? 'CE' : 'PE';
    const strike = selectStrike(spotPrice, optionType as any, config.strikeInterval);

    // Fetch option chain to get instrument token and current premium
    const chain = await getOptionChain(accessToken, expiry);
    const targetOption = chain.find(
      e => e.strikePrice === strike && e.optionType === optionType
    );

    if (!targetOption) {
      state.lockTimestamp = null;
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `ERROR: No option found for ${strike}${optionType} exp ${expiry}`);
      return;
    }

    // Get current premium via LTP
    const ltpMap = await getLTP(accessToken, [targetOption.instrumentKey]);
    const premium = ltpMap[targetOption.instrumentKey] || targetOption.ltp;

    if (premium <= 0) {
      state.lockTimestamp = null;
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, 'ERROR: Zero premium');
      return;
    }

    // Calculate lot size
    const funds = await getFundsAndMargin(accessToken);
    const lots = calculateLots(funds.availableMargin, premium, config.niftyLotSize, config.maxRiskPct);

    if (lots === 0) {
      state.lockTimestamp = null;
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `SKIP: Insufficient margin (avail=${funds.availableMargin}, premium=${premium})`);
      return;
    }

    const quantity = lotsToQuantity(lots, config.niftyLotSize);
    const correlationId = generateCorrelationId();

    // Use aggressive limit order with 1% buffer, snapped to nearest 0.05 tick size
    const bufferedPrice = Math.round((premium * 1.01) * 20) / 20;

    // Build order payload
    const order: OrderPayload = {
      orderId: crypto.randomUUID(),
      correlationId,
      instrumentToken: targetOption.instrumentKey,
      tradingSymbol: targetOption.tradingSymbol,
      optionType: optionType as any,
      strikePrice: strike,
      transactionType: 'BUY',
      quantity,
      lots,
      orderPrice: bufferedPrice,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    // Write to KV for local daemon polling
    await addPendingOrder(env.TRADING_KV, order);

    // Log to D1
    await env.TRADING_DB.prepare(
      `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(order.orderId, correlationId, order.instrumentToken, order.tradingSymbol, optionType, strike, 'BUY', quantity, lots, premium, 'PENDING').run();

    // Update bot state with new position intent
    state.activePosition = {
      correlationId,
      optionType: optionType as any,
      instrumentToken: targetOption.instrumentKey,
      tradingSymbol: targetOption.tradingSymbol,
      strikePrice: strike,
      entryPrice: premium,
      quantity,
      lots,
      enteredAt: new Date().toISOString(),
    };
    state.lastMacdLine = currentMacd;
    state.lockTimestamp = null;
    await saveBotState(env.TRADING_KV, state);

    await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status,
      `SIGNAL: ${signal} → ${targetOption.tradingSymbol} × ${lots} lots @ ₹${premium}`);

  } catch (error: any) {
    // Ensure lock is released on error
    state.lockTimestamp = null;
    await saveBotState(env.TRADING_KV, state);
    await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, `CRON_ERROR: ${error.message}`);
  }
}

// --- Square Off Helper ---

async function dispatchSquareOff(env: Env, state: BotState, token: string, config: BotConfig): Promise<void> {
  if (!state.activePosition) return;

  const pos = state.activePosition;
  const correlationId = generateCorrelationId();

  const sellOrder: OrderPayload = {
    orderId: crypto.randomUUID(),
    correlationId,
    instrumentToken: pos.instrumentToken,
    tradingSymbol: pos.tradingSymbol,
    optionType: pos.optionType,
    strikePrice: pos.strikePrice,
    transactionType: 'SELL',
    quantity: pos.quantity,
    lots: pos.lots,
    orderPrice: 0, // Market order
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  await addPendingOrder(env.TRADING_KV, sellOrder);

  await env.TRADING_DB.prepare(
    `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sellOrder.orderId, correlationId, pos.instrumentToken, pos.tradingSymbol, pos.optionType, pos.strikePrice, 'SELL', pos.quantity, pos.lots, 0, 'PENDING').run();

  // Active position will be cleared by /api/confirm once the order is FILLED
}

// --- EOD Summary (Cloudflare Workers AI) ---

async function generateEODSummary(env: Env): Promise<void> {
  const today = getTodayDateStr();

  // Check if summary already exists
  const existing = await env.TRADING_DB.prepare('SELECT id FROM daily_summary WHERE trade_date = ?').bind(today).first();
  if (existing) return;

  // Gather today's data
  const orders = await env.TRADING_DB.prepare(
    `SELECT * FROM order_ledger WHERE date(created_at) = ? ORDER BY created_at`
  ).bind(today).all();

  const telemetry = await env.TRADING_DB.prepare(
    `SELECT * FROM system_telemetry WHERE date(timestamp) = ? ORDER BY timestamp`
  ).bind(today).all();

  const totalTrades = orders.results?.length || 0;
  if (totalTrades === 0) {
    await env.TRADING_DB.prepare(
      `INSERT INTO daily_summary (trade_date, total_trades, ai_summary) VALUES (?, 0, 'No trades executed today.')`
    ).bind(today).run();
    return;
  }

  // Build prompt for Workers AI
  const prompt = `Analyze today's algorithmic trading session for NIFTY options. Provide a concise 3-paragraph summary covering: execution accuracy, signal quality, and recommendations.

Trade Data (${totalTrades} trades):
${JSON.stringify(orders.results, null, 2)}

Telemetry Samples (last 10):
${JSON.stringify((telemetry.results || []).slice(-10), null, 2)}`;

  try {
    const aiResponse: any = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are a quantitative trading analyst. Be concise and data-driven.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
    });

    const summary = aiResponse?.response || 'AI summary generation failed.';
    const filledOrders = (orders.results || []).filter((o: any) => o.order_status === 'FILLED');
    const winningTrades = filledOrders.filter((o: any) => (o as any).pnl > 0).length;
    const totalPnl = filledOrders.reduce((sum: number, o: any) => sum + ((o as any).pnl || 0), 0);

    await env.TRADING_DB.prepare(
      `INSERT INTO daily_summary (trade_date, total_trades, winning_trades, total_pnl, ai_summary) VALUES (?, ?, ?, ?, ?)`
    ).bind(today, totalTrades, winningTrades, totalPnl, summary).run();
  } catch (e: any) {
    await env.TRADING_DB.prepare(
      `INSERT INTO daily_summary (trade_date, total_trades, ai_summary) VALUES (?, ?, ?)`
    ).bind(today, totalTrades, `AI Error: ${e.message}`).run();
  }
}
