// ============================================
// Cron Worker — The Brain
// Executes every minute during market hours
// Evaluates MACD, generates signals, queues orders
// ============================================

import type { Env, BotState, BotConfig, OrderPayload, SignalType, ActivePosition } from './lib/types';
import { KV_KEYS } from './lib/types';
import { getLatestMACDValues, detectZeroCrossover } from './lib/macd';
import { calculateATM, selectStrike, shouldRollExpiry, getNearestWeeklyExpiry, getPreferredStrikes } from './lib/strike';
import { calculateLots, lotsToQuantity } from './lib/lot-sizing';
import { isMarketOpen, isSquareOffTime, isEODSummaryTime, isPreMarketWarmup, getTodayDateStr, generateCorrelationId, getISTTimeFloat } from './lib/time';
import { fetchNiftyCandles, getOptionChain, getFundsAndMargin, getLTP, notifyDiscord } from './lib/upstox';
import { addPendingOrder } from './lib/orders';
import { calculateADX } from './lib/adx';
import { calculateATR } from './lib/atr';
import { calculateVWAP } from './lib/vwap';
import { calculatePCR } from './lib/pcr';
import { executePaperTrade } from './lib/paper';

// --- Config Loader ---

async function loadConfig(db: D1Database): Promise<BotConfig> {
  const rows = await db.prepare('SELECT config_key, config_value FROM bot_configuration').all();
  const map: Record<string, string> = {};
  for (const r of rows.results || []) {
    map[(r as any).config_key] = (r as any).config_value;
  }
  return {
    maxRiskPct: parseFloat(map['max_risk_pct'] || '100'),
    niftyLotSize: parseInt(map['nifty_lot_size'] || '65', 10),
    rolloverOnExpiry: map['rollover_on_expiry'] === 'true',
    defaultExpiry: map['default_expiry'] || 'weekly',
    maxStrikeLevels: parseInt(map['max_strike_levels'] || '2', 10),
    strikeInterval: parseInt(map['strike_interval'] || '50', 10),
    squareOffTime: map['square_off_time'] || '15:15',
    paperMode: map['paper_mode'] === 'true',
    maxSlippagePct: parseFloat(map['max_slippage_pct'] || '1'),
    gexAvoidanceEnabled: map['gex_avoidance_enabled'] === 'true',
    gexStrikeBuffer: parseInt(map['gex_strike_buffer'] || '25', 10),
    adxFilterEnabled: map['adx_filter_enabled'] === 'true',
    adxThreshold: parseInt(map['adx_threshold'] || '20', 10),
    momentumDecayEnabled: map['momentum_decay_enabled'] === 'true',
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

async function pruneTelemetry(db: D1Database): Promise<void> {
  await db.prepare(
    "DELETE FROM system_telemetry WHERE timestamp < datetime('now', '-7 days')"
  ).run();
}

async function checkDailyDrawdown(db: D1Database, margin: number): Promise<boolean> {
  const result = await db.prepare(
    "SELECT SUM(pnl) as total_pnl FROM order_ledger WHERE date(created_at) = date('now')"
  ).first();
  const totalPnl = (result?.total_pnl as number) || 0;
  return margin > 0 && totalPnl <= -(margin * 0.05);
}

// --- Main Cron Handler ---

export async function handleScheduled(env: Env): Promise<void> {
  console.log("CRON START");
  const config = await loadConfig(env.TRADING_DB);
  const state = await getBotState(env.TRADING_KV);

  // We will check the RUNNING state AFTER calculating MACD
  // so that the chart continues to plot even when the bot is stopped or orphaned.
  // GATE 2: Get access token
  const accessToken = await env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
  console.log("GATE 2 token exists:", !!accessToken);
  if (!accessToken) {
    if (state.status === 'RUNNING') {
      await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, 'SKIP: No Upstox access token');
    }
    return;
  }

  // --- NEW: FETCH & CACHE AVAILABLE MARGIN & CHECK DRAWDOWN ---
  if (isMarketOpen() || isPreMarketWarmup()) {
    try {
      const funds = await getFundsAndMargin(accessToken);
      await env.TRADING_KV.put(KV_KEYS.ACCOUNT_MARGIN, JSON.stringify({
        ...funds,
        timestamp: Date.now()
      }));

      // Daily Drawdown Check
      const isDrawdownBreached = await checkDailyDrawdown(env.TRADING_DB, funds.totalBalance || funds.availableMargin);
      console.log("Drawdown breached:", isDrawdownBreached);
      if (isDrawdownBreached && state.status === 'RUNNING') {
        state.status = 'SYSTEM_HALT' as any;
        await saveBotState(env.TRADING_KV, state);
        await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, 'SYSTEM HALT: Daily drawdown limit breached (-5%)');
        await notifyDiscord(env.DISCORD_WEBHOOK_URL, `🚨 **SYSTEM HALTED**\nDaily loss limit (-5%) breached! Trading suspended for today.`);
      }
    } catch (e: any) {
      // Fail silently to avoid interrupting trade logic
    }
  }

  // Daemon Heartbeat Check
  const lastHeartbeat = await env.TRADING_KV.get('daemon_last_heartbeat');
  console.log("lastHeartbeat:", lastHeartbeat, "Age:", lastHeartbeat ? Date.now() - parseInt(lastHeartbeat) : 'none');
  if (lastHeartbeat && Date.now() - parseInt(lastHeartbeat) > 3 * 60 * 1000) {
    if (state.status === 'RUNNING') {
      state.status = 'ORPHANED' as any;
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, 'ORPHANED: Daemon heartbeat stale (>3m)');
      await notifyDiscord(env.DISCORD_WEBHOOK_URL, `🚨 **DAEMON OFFLINE**\nHeartbeat stale. Halt entries.`);
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
      if (state.status === 'RUNNING') {
        await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, `WARMUP_ERROR: ${e.message}`);
      }
    }
    return;
  }

  // GATE 3: Market must be open
  console.log("isMarketOpen:", isMarketOpen(), "isEODSummary:", isEODSummaryTime());
  if (!isMarketOpen()) {
    // Check for EOD summary
    if (isEODSummaryTime()) {
      try {
        await generateEODSummary(env);
        await pruneTelemetry(env.TRADING_DB);
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
      if (state.status === 'RUNNING') {
        await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, `SKIP: Insufficient candles (${candles.length})`);
      }
      return;
    }

    // Current spot = latest candle close
    spotPrice = candles[candles.length - 1].close;
    atmStrike = calculateATM(spotPrice, config.strikeInterval);

    const currentAdx = calculateADX(candles);
    const currentAtr = calculateATR(candles);
    const currentVwap = calculateVWAP(candles);

    // Compute MACD
    const closes = candles.map(c => c.close);
    const macdResult = getLatestMACDValues(closes);

    if (!macdResult) {
      if (state.status === 'RUNNING') {
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, 0, 0, 'NONE', state.status, 'SKIP: MACD calculation failed');
      }
      return;
    }

    currentMacd = macdResult.current;
    prevMacd = macdResult.previous;

    // Fetch option chain to calculate PCR
    let pcrVal: number | undefined;
    try {
      const rollover = shouldRollExpiry(new Date(), config.rolloverOnExpiry);
      const expiry = getNearestWeeklyExpiry(new Date(), rollover);
      const chain = await getOptionChain(accessToken, expiry);
      pcrVal = calculatePCR(chain);
    } catch (e) {
      // Fail silently
    }

    state.indicators = {
      pcr: pcrVal,
      macd: currentMacd,
      macdSignal: macdResult.signalLine[macdResult.signalLine.length - 1],
      macdHist: macdResult.histogram[macdResult.histogram.length - 1],
      atr: currentAtr,
      adx: currentAdx
    };

    // Save state with updated indicators
    await saveBotState(env.TRADING_KV, state);

    // DETECT SIGNAL
    const signal = detectZeroCrossover(currentMacd, prevMacd);

    // Write telemetry for chart regardless of running state
    if (!signal) {
      state.lastMacdLine = currentMacd;
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, null);
    } else {
      if (state.status !== 'RUNNING') {
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `SIGNAL DETECTED BUT BOT IS ${state.status}: ${signal}`);
      }
    }

    // GATE 1: Bot must be RUNNING
    if (state.status !== 'RUNNING') {
      return;
    }

    // ==========================================
    // RISK MANAGEMENT: EVALUATE ALL ACTIVE LEGS
    // ==========================================
    const activeKeys: ('activePosition' | 'activeHedgePosition')[] = ['activePosition', 'activeHedgePosition'];
    
    for (const key of activeKeys) {
      const pos = state[key];
      if (pos && !state.lockTimestamp) {
        try {
          const ltpData = await getLTP(accessToken, [pos.instrumentToken]);
          const currentLTP = ltpData[pos.instrumentToken];

          if (currentLTP && pos.entryPrice) {
            const entry = pos.entryPrice;
            pos.highestPrice = Math.max(pos.highestPrice || entry, currentLTP);
            
            const atr = pos.entryAtr || currentAtr; 
            const optionDelta = 0.4; 
            const atrPremiumPoints = atr * optionDelta;
            const maxProfitPct = ((pos.highestPrice - entry) / entry) * 100;

            // Free-Ride Scale Out
            if ((maxProfitPct >= 33.0 || (pos.highestPrice - entry) >= (2.5 * atrPremiumPoints)) && !pos.scaleOutDone && pos.lots > 1) {
              const lotsToSell = Math.floor(pos.lots / 2);
              await dispatchSquareOff(env, state, accessToken, config, lotsToSell, pos, currentLTP); // Passed targetPos
              pos.lots -= lotsToSell;
              pos.quantity -= (lotsToSell * config.niftyLotSize);
              pos.scaleOutDone = true;
              await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, `SCALE-OUT: Secured 50% profit on ${pos.optionType}.`);
            }

            // Momentum Decay
            let isMomentumDecaying = false;
            const hist = macdResult.histogram;
            if (hist.length >= 3) {
              const [h3, h2, h1] = [hist[hist.length-3], hist[hist.length-2], hist[hist.length-1]];
              if (h3 > 0 && h2 > 0 && h1 > 0 && h3 > h2 && h2 > h1) isMomentumDecaying = true;
              if (h3 < 0 && h2 < 0 && h1 < 0 && h3 < h2 && h2 < h1) isMomentumDecaying = true;
            }

            const hardSLBase = entry - (1.5 * atrPremiumPoints);
            let activeTSLBase = pos.highestPrice - (1.5 * atrPremiumPoints);
            
            if (isMomentumDecaying && (currentLTP - entry) > (0.5 * atrPremiumPoints)) {
              activeTSLBase = Math.max(activeTSLBase, currentLTP - (0.5 * atrPremiumPoints)); 
            }

            // ==========================================
            // MANUAL OVERRIDE INJECTION
            // ==========================================
            // If a human dragged the line, use that exact price. Otherwise, use the ATR engine.
            const hardSLPrice = pos.manualHardSL || hardSLBase;
            const activeTSLPrice = pos.manualTrailingSL || activeTSLBase;

            const isHardSLHit = currentLTP <= hardSLPrice && pos.highestPrice === entry;
            const isTrailingSLHit = currentLTP <= activeTSLPrice && !isHardSLHit;

            if (isHardSLHit || isTrailingSLHit) {
              const exitReason = isHardSLHit ? 'HARD_SL_HIT_ATR' : 'TRAILING_SL_HIT_ATR';
              await logTelemetry(env.TRADING_DB, spotPrice, pos.strikePrice, currentMacd, prevMacd, 'NONE', state.status, `EXIT: ${exitReason} (${pos.optionType}). LTP: ₹${currentLTP}, TSL Line: ₹${activeTSLPrice.toFixed(2)}`);
              await notifyDiscord(env.DISCORD_WEBHOOK_URL, `🛡️ **STOP LOSS: ${exitReason}**\nContract: \`${pos.tradingSymbol}\`\nLTP: ₹${currentLTP}`);

              await dispatchSquareOff(env, state, accessToken, config, undefined, pos, currentLTP); // Passed targetPos
              state.lockTimestamp = Date.now();
              await saveBotState(env.TRADING_KV, state);
              break; // Stop loop to only dispatch one order per cron tick (prevents Upstox rate limits)
            } else {
              await saveBotState(env.TRADING_KV, state);
            }
          }
        } catch (error: any) {
          console.error(`Failed to fetch LTP for Risk Management check on ${pos.optionType}:`, error);
        }
      }
    }

    // AUTO SQUARE-OFF CHECK
    if (isSquareOffTime(config.squareOffTime)) {
      let squaredOff = false;
      if (state.activePosition) {
        await dispatchSquareOff(env, state, accessToken, config, undefined, state.activePosition);
        squaredOff = true;
      }
      if (state.activeHedgePosition) {
        await dispatchSquareOff(env, state, accessToken, config, undefined, state.activeHedgePosition);
        squaredOff = true;
      }
      if (squaredOff) {
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, 'AUTO_SQUAREOFF: Time-based exit');
      }
      return;
    }

    if (!signal) {
      return;
    }

    // --- SIGNAL DETECTED ---

    // ==========================================
    // TIME-OF-DAY FILTER (The "Theta Death Zone")
    // ==========================================
    const currentIST = getISTTimeFloat();
    
    // Example: Block new entries between 12:30 PM (12.5) and 2:00 PM (14.0)
    const isThetaDeathZone = currentIST >= 12.5 && currentIST <= 14.0;

    if (isThetaDeathZone) {
      // Only block if we DON'T have an active position. 
      // If we have an active position, we MUST allow the cron to run to manage the Stop Loss!
      if (!state.activePosition && !state.activeHedgePosition) {
        state.lastMacdLine = currentMacd; // Update memory
        await logTelemetry(
          env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, 
          `SKIP: Time-of-Day Filter. Market is in the 12:30 - 2:00 PM flat zone.`
        );
        return; // Abort entry
      }
    }

    // ==========================================
    // STRADDLE MODE (Choppy Market Hedgehog)
    // ==========================================
    if (config.adxFilterEnabled && currentAdx < config.adxThreshold) {
      // Wait for the MACD to cross (indicates energy is finally snapping)
      if (!signal) return;

      // We only execute a straddle if we have 0 open positions
      if (state.activePosition || state.activeHedgePosition) return;

      const rollover = shouldRollExpiry(new Date(), config.rolloverOnExpiry);
      const expiry = getNearestWeeklyExpiry(new Date(), rollover);
      const chain = await getOptionChain(accessToken, expiry, env.TRADING_KV);

      // Grab exactly ATM for a perfectly balanced Delta
      const ceStrike = getPreferredStrikes(spotPrice, 'CE', config.strikeInterval, 1)[0];
      const peStrike = getPreferredStrikes(spotPrice, 'PE', config.strikeInterval, 1)[0];

      const targetCE = chain.find((e: any) => e.strikePrice === ceStrike && e.optionType === 'CE');
      const targetPE = chain.find((e: any) => e.strikePrice === peStrike && e.optionType === 'PE');

      if (!targetCE || !targetPE) {
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `STRADDLE SKIP: Missing ATM options.`);
        return;
      }

      // Split risk capital exactly 50/50 between the two legs
      const funds = await getFundsAndMargin(accessToken);
      const halfMargin = funds.availableMargin / 2;
      const ceLots = calculateLots(halfMargin, (targetCE as any).ltp, config.niftyLotSize, config.maxRiskPct);
      const peLots = calculateLots(halfMargin, (targetPE as any).ltp, config.niftyLotSize, config.maxRiskPct);

      if (ceLots < 1 || peLots < 1) {
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `STRADDLE SKIP: Need margin for minimum 1 lot of CE and PE.`);
        return;
      }

      // -- DISPATCH LEG 1 (CE) --
      const ceCorrId = generateCorrelationId();
      const ceQty = ceLots * config.niftyLotSize;
      const ceOrder: OrderPayload = {
        orderId: crypto.randomUUID(), correlationId: ceCorrId, instrumentToken: (targetCE as any).instrumentKey,
        tradingSymbol: (targetCE as any).tradingSymbol, optionType: 'CE', strikePrice: ceStrike,
        transactionType: 'BUY', quantity: ceQty, lots: ceLots, orderPrice: Math.round(((targetCE as any).ltp * 1.01) * 20) / 20,
        status: 'PENDING', createdAt: new Date().toISOString()
      };

      // -- DISPATCH LEG 2 (PE) --
      const peCorrId = generateCorrelationId();
      const peQty = peLots * config.niftyLotSize;
      const peOrder: OrderPayload = {
        orderId: crypto.randomUUID(), correlationId: peCorrId, instrumentToken: (targetPE as any).instrumentKey,
        tradingSymbol: (targetPE as any).tradingSymbol, optionType: 'PE', strikePrice: peStrike,
        transactionType: 'BUY', quantity: peQty, lots: peLots, orderPrice: Math.round(((targetPE as any).ltp * 1.01) * 20) / 20,
        status: 'PENDING', createdAt: new Date().toISOString()
      };

      const isPaperMode = state.tradingMode === 'PAPER';

      if (isPaperMode) {
        // ==========================================
        // PAPER TRADING VIRTUAL STRADDLE EXECUTION
        // ==========================================
        await executePaperTrade(env, ceOrder, (targetCE as any).ltp);
        await executePaperTrade(env, peOrder, (targetPE as any).ltp);

        // Fetch back the newly written activePosition and activeHedgePosition, add straddle specific fields
        const stateRaw = await env.TRADING_KV.get(KV_KEYS.BOT_STATE);
        if (stateRaw) {
          const updatedState = JSON.parse(stateRaw);
          if (updatedState.activePosition) updatedState.activePosition.isStraddleLeg = true;
          if (updatedState.activeHedgePosition) updatedState.activeHedgePosition.isStraddleLeg = true;
          updatedState.lockTimestamp = Date.now();
          await saveBotState(env.TRADING_KV, updatedState);
        }

        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, 
          `[PAPER MODE] Virtual Straddle Fill -> CE @ ₹${(targetCE as any).ltp} & PE @ ₹${(targetPE as any).ltp}`
        );
      } else {
        // ==========================================
        // LIVE TRADING REAL STRADDLE EXECUTION
        // ==========================================
        await addPendingOrder(env.TRADING_KV, ceOrder);
        await env.TRADING_DB.prepare(`INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(ceOrder.orderId, ceCorrId, ceOrder.instrumentToken, ceOrder.tradingSymbol, 'CE', ceStrike, 'BUY', ceQty, ceLots, (targetCE as any).ltp, 'PENDING').run();
        
        state.activePosition = {
          correlationId: ceCorrId, optionType: 'CE', instrumentToken: (targetCE as any).instrumentKey,
          tradingSymbol: (targetCE as any).tradingSymbol, strikePrice: ceStrike, entryPrice: (targetCE as any).ltp, highestPrice: (targetCE as any).ltp,
          quantity: ceQty, lots: ceLots, enteredAt: new Date().toISOString(), entryAtr: currentAtr, isStraddleLeg: true
        };

        await addPendingOrder(env.TRADING_KV, peOrder);
        await env.TRADING_DB.prepare(`INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(peOrder.orderId, peCorrId, peOrder.instrumentToken, peOrder.tradingSymbol, 'PE', peStrike, 'BUY', peQty, peLots, (targetPE as any).ltp, 'PENDING').run();

        state.activeHedgePosition = {
          correlationId: peCorrId, optionType: 'PE', instrumentToken: (targetPE as any).instrumentKey,
          tradingSymbol: (targetPE as any).tradingSymbol, strikePrice: peStrike, entryPrice: (targetPE as any).ltp, highestPrice: (targetPE as any).ltp,
          quantity: peQty, lots: peLots, enteredAt: new Date().toISOString(), entryAtr: currentAtr, isStraddleLeg: true
        };

        state.lockTimestamp = Date.now();
        await saveBotState(env.TRADING_KV, state);
        
        await notifyDiscord(env.DISCORD_WEBHOOK_URL, `🦔 **STRADDLE EXECUTED (Choppy Market)**\nLeg 1: CE @ ₹${(targetCE as any).ltp}\nLeg 2: PE @ ₹${(targetPE as any).ltp}`);
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `STRADDLE EXECUTED: Bought ATM CE & PE.`);
      }
      
      return; // Critical: Stop here so we don't also execute a normal directional trade.
    }

    // ==========================================
    // MEAN REVERSION FILTER (VWAP EXTENSION)
    // ==========================================
    if (signal === 'BUY_CE' && currentVwap > 0) {
      const extensionPct = ((spotPrice - currentVwap) / currentVwap) * 100;
      
      // If NIFTY is > 1% above VWAP, it is over-extended. Block the CE trade.
      if (extensionPct > 1.0) {
        state.lastMacdLine = currentMacd;
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, `SKIP: Mean Reversion Risk. NIFTY is ${extensionPct.toFixed(2)}% above VWAP.`);
        return; // Abort entry
      }
    }

    if (signal === 'BUY_PE' && currentVwap > 0) {
      const dropPct = ((currentVwap - spotPrice) / currentVwap) * 100;
      
      // If NIFTY is > 1% below VWAP, it is over-extended downward. Block the PE trade.
      if (dropPct > 1.0) {
        state.lastMacdLine = currentMacd;
        await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, `SKIP: Mean Reversion Risk. NIFTY is ${dropPct.toFixed(2)}% below VWAP.`);
        return; // Abort entry
      }
    }

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

    // Determine expiry and base option type
    const rollover = shouldRollExpiry(new Date(), config.rolloverOnExpiry);
    const expiry = getNearestWeeklyExpiry(new Date(), rollover);
    const optionType = signal === 'BUY_CE' ? 'CE' : 'PE';

    // 1. Generate fallback strike preferences (ATM -> OTM1 -> OTM2 -> OTM3 -> OTM4)
    const preferredStrikes = getPreferredStrikes(spotPrice, optionType as any, config.strikeInterval, 4);

    // 2. Fetch Option Chain
    const chain = await getOptionChain(accessToken, expiry);

    // ==========================================
    // INSTITUTIONAL FLOW FILTER (Put-Call Ratio)
    // ==========================================
    const currentPCR = calculatePCR(chain);

    if (signal === 'BUY_CE' && currentPCR < 0.7) {
      state.lockTimestamp = null;
      state.lastMacdLine = currentMacd; // Update memory so it doesn't spam the DB on the next tick
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(
        env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, 
        `SKIP: Institutional Flow Bearish. PCR is ${currentPCR.toFixed(2)} (< 0.7). Blocking CE Entry.`
      );
      return; // Abort entry
    }

    if (signal === 'BUY_PE' && currentPCR > 1.3) {
      state.lockTimestamp = null;
      state.lastMacdLine = currentMacd; 
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(
        env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, 
        `SKIP: Institutional Flow Bullish. PCR is ${currentPCR.toFixed(2)} (> 1.3). Blocking PE Entry.`
      );
      return; // Abort entry
    }

    // 3. Map preferred strikes to actual option instruments in the chain
    const candidateOptions = preferredStrikes.map(strike =>
      chain.find(e => e.strikePrice === strike && e.optionType === optionType)
    ).filter(Boolean); // Removes any undefined if the chain data is incomplete

    if (candidateOptions.length === 0) {
      state.lockTimestamp = null;
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `ERROR: No valid options found for exp ${expiry}`);
      return;
    }

    // 4. Batch fetch LTP for all 5 candidates simultaneously (Saves API calls & execution time)
    const candidateKeys = candidateOptions.map((opt: any) => opt.instrumentKey);
    const ltpMap = await getLTP(accessToken, candidateKeys);

    // 5. Get available margin to test affordability
    const funds = await getFundsAndMargin(accessToken);

    let targetOption = null;
    let lots = 0;
    let premium = 0;
    let strike = 0;

    // 6. Evaluate candidates in order. Break loop on the first affordable one.
    for (const opt of candidateOptions) {
      const currentPremium = (ltpMap as any)[(opt as any).instrumentKey]?.last_price || ltpMap[(opt as any).instrumentKey] || (opt as any).ltp;
      if (currentPremium <= 0) continue;

      const calcLots = calculateLots(funds.availableMargin, currentPremium, config.niftyLotSize, config.maxRiskPct);

      if (calcLots > 0) {
        targetOption = opt;
        lots = calcLots;
        premium = currentPremium;
        strike = (opt as any).strikePrice;
        break; // We found our affordable strike! Exit the loop.
      }
    }

    // 7. If all 5 levels (ATM + 4 OTMs) are still too expensive
    if (!targetOption || lots === 0) {
      state.lockTimestamp = null;
      await saveBotState(env.TRADING_KV, state);
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, `SKIP: Insufficient margin for ATM & all 4 OTM levels (avail=₹${funds.availableMargin.toFixed(2)})`);
      return;
    }

    // ==========================================
    // THETA MELT FILTER (0DTE Risk Management)
    // ==========================================
    const todayStr = getTodayDateStr(); // e.g. '2026-07-12'
    const isExpiryDay = (targetOption as any).expiryDate === todayStr;
    
    // Check if the selected strike is Out-Of-The-Money (OTM)
    const isOTM = signal === 'BUY_CE' 
      ? (targetOption as any).strikePrice > spotPrice 
      : (targetOption as any).strikePrice < spotPrice;

    if (isExpiryDay && isOTM) {
      // Set the maximum acceptable daily premium decay (e.g., losing 15 rupees per day is too high)
      const MAX_THETA_DECAY = 15.0; 
      
      // Theta is natively negative. We use absolute value for easier comparison.
      const optionTheta = Math.abs((targetOption as any).theta);

      if (optionTheta > MAX_THETA_DECAY) {
        state.lastMacdLine = currentMacd; // Update MACD memory so we don't spam the DB
        state.lockTimestamp = null; // Release the evaluation lock
        await saveBotState(env.TRADING_KV, state);
        await logTelemetry(
          env.TRADING_DB, 
          spotPrice, 
          atmStrike, 
          currentMacd, 
          prevMacd, 
          'NONE', 
          state.status, 
          `SKIP: Theta Melt Risk. 0DTE OTM Option has extreme time decay (-${optionTheta.toFixed(2)} pts).`
        );
        return; // Abort the trade
      }
    }

    const quantity = lotsToQuantity(lots, config.niftyLotSize);
    const correlationId = generateCorrelationId();

    // Use aggressive limit order with configurable slippage buffer, snapped to nearest 0.05 tick size
    const bufferedPrice = Math.round((premium * (1 + config.maxSlippagePct / 100)) * 20) / 20;

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

    const isPaperMode = state.tradingMode === 'PAPER';

    if (isPaperMode) {
      // ==========================================
      // PAPER TRADING VIRTUAL EXECUTION
      // ==========================================
      await executePaperTrade(env, order, premium);
      
      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status, 
        `[PAPER MODE] Virtual Fill -> ${signal} → ${targetOption.tradingSymbol} × ${lots} lots @ ₹${premium}`
      );
    } else {
      // ==========================================
      // LIVE TRADING REAL EXECUTION
      // ==========================================
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
        highestPrice: premium,
        quantity,
        lots,
        enteredAt: new Date().toISOString(),
        entryAtr: currentAtr,
      };
      state.lastMacdLine = currentMacd;
      state.lockTimestamp = null;
      await saveBotState(env.TRADING_KV, state);

      await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, signal, state.status,
        `SIGNAL: ${signal} → ${targetOption.tradingSymbol} × ${lots} lots @ ₹${premium}`);

      await notifyDiscord(
        env.DISCORD_WEBHOOK_URL,
        `🟢 **NEW ENTRY EXECUTED**\nSignal: **${signal}**\nContract: \`${targetOption.tradingSymbol}\`\nLots: **${lots}**\nEst. Premium: ₹${premium}\nBuffered Limit: ₹${bufferedPrice}`
      );
    }

  } catch (error: any) {
    // Ensure lock is released on error
    state.lockTimestamp = null;
    await saveBotState(env.TRADING_KV, state);
    await logTelemetry(env.TRADING_DB, spotPrice, atmStrike, currentMacd, prevMacd, 'NONE', state.status, `CRON_ERROR: ${error.message}`);
    
    await notifyDiscord(
      env.DISCORD_WEBHOOK_URL,
      `🚨 **SYSTEM ERROR (CRON)**\n\`${error.message}\``
    );
  }
}

// --- Square Off Helper ---

async function dispatchSquareOff(env: Env, state: BotState, token: string, config: BotConfig, lotsToSell?: number, targetPos?: ActivePosition, currentLtp?: number): Promise<void> {
  const pos = targetPos || state.activePosition;
  if (!pos) return;
  const correlationId = lotsToSell !== undefined ? `SCAL-${generateCorrelationId()}` : generateCorrelationId();

  const lots = lotsToSell !== undefined ? lotsToSell : pos.lots;
  const quantity = lotsToSell !== undefined ? (lotsToSell * config.niftyLotSize) : pos.quantity;

  const sellOrder: OrderPayload = {
    orderId: crypto.randomUUID(),
    correlationId,
    instrumentToken: pos.instrumentToken,
    tradingSymbol: pos.tradingSymbol,
    optionType: pos.optionType,
    strikePrice: pos.strikePrice,
    transactionType: 'SELL',
    quantity,
    lots,
    orderPrice: 0, // Market order
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  const isPaperMode = state.tradingMode === 'PAPER';
  if (isPaperMode) {
    let currentLtpToUse = currentLtp;
    if (!currentLtpToUse) {
      try {
        const ltpData = await getLTP(token, [pos.instrumentToken]);
        currentLtpToUse = ltpData[pos.instrumentToken] || 0;
      } catch (e) {
        currentLtpToUse = 0;
      }
    }

    await executePaperTrade(env, sellOrder, currentLtpToUse);

    await logTelemetry(env.TRADING_DB, 0, 0, 0, 0, 'NONE', state.status, 
      `[PAPER MODE] Virtual Square-Off -> ${pos.tradingSymbol} (${lots} lots) @ ₹${currentLtpToUse.toFixed(2)}`
    );
    return;
  }

  await addPendingOrder(env.TRADING_KV, sellOrder);

  await env.TRADING_DB.prepare(
    `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sellOrder.orderId, correlationId, pos.instrumentToken, pos.tradingSymbol, pos.optionType, pos.strikePrice, 'SELL', quantity, lots, 0, 'PENDING').run();

  await notifyDiscord(
    env.DISCORD_WEBHOOK_URL,
    `⚡ **SQUARE-OFF DISPATCHED**\nClosing \`${pos.tradingSymbol}\` (${lots} lots) at Market Price.`
  );

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

// ============================================
// CONFIGURATION SNAPSHOT (Runs at Midnight IST)
// ============================================
export async function takeConfigSnapshot(env: Env): Promise<void> {
  const today = getTodayDateStr();
  
  // Prevent duplicate snapshots for the exact same day
  const existing = await env.TRADING_DB.prepare(
    'SELECT id FROM bot_configuration_history WHERE snapshot_date = ? LIMIT 1'
  ).bind(today).first();
  
  if (existing) {
    console.log(`Snapshot for ${today} already exists. Skipping.`);
    return;
  }

  // Copy current configuration into the history table
  await env.TRADING_DB.prepare(
    `INSERT INTO bot_configuration_history (snapshot_date, config_key, config_value)
     SELECT ?, config_key, config_value FROM bot_configuration`
  ).bind(today).run();
  
  console.log(`✅ Configuration snapshot secured for ${today}`);
}
