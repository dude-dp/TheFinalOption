// ============================================
// Hono API Routes — The Bridge
// Secure endpoints for daemon polling, dashboard
// ============================================

import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env, BotState, ConfirmRequest, OrderPayload, PollResponse } from '../lib/types';
import { KV_KEYS } from '../lib/types';
import { getAuthorizationUrl, exchangeCodeForToken, fetchNiftyCandles, getOptionChain, getLTP, getFundsAndMargin } from '../lib/upstox';
import { getPreferredStrikes, shouldRollExpiry, getNearestWeeklyExpiry } from '../lib/strike';
import { calculateLots, lotsToQuantity } from '../lib/lot-sizing';
import { getTodayDateStr, generateCorrelationId } from '../lib/time';
import { addPendingOrder, removePendingOrder } from '../lib/orders';

const api = new Hono<{ Bindings: Env }>();

// --- Middleware: Poll Secret Auth ---

function requirePollSecret(c: any, next: any) {
  const secret = c.req.header('X-Poll-Secret');
  if (secret !== c.env.POLL_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

const dashboardAuth = basicAuth({
  verifyUser: (username, password, c) => {
    return username === 'vdineshprabu' && password === 'Healthywealth007#';
  },
});

// Apply it to ALL dashboard UI & control routes:
api.use('/api/status', dashboardAuth);
api.use('/api/control', dashboardAuth);
api.use('/api/emergency-squareoff', dashboardAuth);
api.use('/api/orders', dashboardAuth);
api.use('/api/telemetry', dashboardAuth);
api.use('/api/chart-data', dashboardAuth);
api.use('/api/summary', dashboardAuth);
api.use('/api/config', dashboardAuth);

// =====================
// DAEMON ENDPOINTS
// =====================

/**
 * GET /api/poll
 * Local daemon polls this every 1.5s.
 * Receives daemon's RSS memory, checks watchdog, returns any PENDING orders.
 */
api.post('/api/poll', async (c) => {
  const body = await c.req.json<{ 
    secret: string; 
    memoryRss?: number; 
    memoryHeapUsed?: number;
    rateMetrics?: { reqPerSecond: number; reqPerMinute: number };
  }>();
  
  // 1. Authenticate the payload
  const expectedSecret = c.env.POLL_SECRET;
  if (!body.secret || body.secret !== expectedSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const kv = c.env.TRADING_KV;

  // 2. Fetch the active state of the bot
  const stateRaw = await kv.get(KV_KEYS.BOT_STATE);
  if (!stateRaw) return c.json({ error: 'Bot state not found' }, 404);
  const state: BotState = JSON.parse(stateRaw);

  // Update live rate metrics from the daemon
  if (body.rateMetrics) {
    state.daemonMetrics = {
      reqPerSecond: body.rateMetrics.reqPerSecond,
      reqPerMinute: body.rateMetrics.reqPerMinute,
      lastUpdated: Date.now()
    };
    await kv.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
  }

  let triggerWatchdogRestart = false;
  const MEMORY_LIMIT_BYTES = 500 * 1024 * 1024; // Exactly 500 MB

  // 3. Evaluate Memory Limits & Position Safeties
  if (body.memoryRss && body.memoryRss > MEMORY_LIMIT_BYTES) {
    // CRITICAL SAFETY CHECK: Verify no directional or straddle positions are open
    const hasNoActivePositions = !state.activePosition && !state.activeHedgePosition;
    
    if (hasNoActivePositions) {
      triggerWatchdogRestart = true;
      
      // Log an audit trail entry into the D1 Telemetry Table for system tracking
      const currentMemoryMB = (body.memoryRss / 1024 / 1024).toFixed(1);
      await c.env.TRADING_DB.prepare(
        `INSERT INTO system_telemetry (nifty_spot, atm_strike, macd_line, prev_macd_line, signal_generated, bot_status, log_message) 
         VALUES (0, 0, 0, 0, 'NONE', ?, ?)`
      ).bind(
        state.status || 'STOPPED',
        `WATCHDOG: Triggering daemon restart. RSS: ${currentMemoryMB}MB exceeds 500MB threshold. Position state clear.`
      ).run();
    }
  }

  // 4. Process pending orders if we are NOT restarting
  const orders: OrderPayload[] = [];
  let accessToken = null;
  
  if (!triggerWatchdogRestart) {
    // Get pending orders array from KV
    const rawPending = await kv.get(KV_KEYS.PENDING_ORDERS);
    const pendingList: OrderPayload[] = rawPending ? JSON.parse(rawPending) : [];
    const remainingList: OrderPayload[] = [];
    let changed = false;

    for (const order of pendingList) {
      if (order.status === 'PENDING') {
        orders.push(order);
        // Mark as DISPATCHED to prevent duplicate pickup
        order.status = 'DISPATCHED';
        changed = true;
        // Update D1
        await c.env.TRADING_DB.prepare(
          `UPDATE order_ledger SET order_status = 'DISPATCHED', updated_at = datetime('now') WHERE correlation_id = ?`
        ).bind(order.correlationId).run();
      }
      remainingList.push(order);
    }

    if (changed) {
      await kv.put(KV_KEYS.PENDING_ORDERS, JSON.stringify(remainingList));
    }

    // Get access token for daemon to use
    accessToken = await kv.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
  }

  return c.json({
    success: true,
    shouldRestart: triggerWatchdogRestart,
    hasOrders: orders.length > 0,
    orders,
    accessToken,
    botStatus: state.status || 'STOPPED',
  });
});

/**
 * GET /api/unresolved-orders
 * Local daemon polls this every 15s to clean up 'Phantom Orders'
 */
api.get('/api/unresolved-orders', requirePollSecret, async (c) => {
  // Find orders that were dispatched but never reached a final state
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT correlation_id, upstox_order_id, order_status, created_at 
     FROM order_ledger 
     WHERE order_status IN ('PARTIALLY_FILLED', 'DISPATCHED') 
     AND upstox_order_id IS NOT NULL 
     AND upstox_order_id != ''`
  ).all();

  const accessToken = await c.env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);

  return c.json({
    hasOrphans: (rows.results && rows.results.length > 0),
    accessToken: accessToken,
    orders: rows.results || []
  });
});

/**
 * POST /api/confirm
 * Daemon sends execution slip after Upstox order placement.
 */
api.post('/api/confirm', requirePollSecret, async (c) => {
  const body: ConfirmRequest = await c.req.json();
  const { correlationId, upstoxOrderId, status, executionPrice, filledQuantity, rejectionReason } = body;

  // Idempotency check
  const existing = await c.env.TRADING_DB.prepare(
    'SELECT order_status FROM order_ledger WHERE correlation_id = ? AND order_status IN (?, ?, ?)'
  ).bind(correlationId, 'FILLED', 'REJECTED', 'CANCELLED').first();
  if (existing) return c.json({ success: true, correlationId, idempotent: true });

  let pnlToUpdate = 0;
  const order = await c.env.TRADING_DB.prepare(
    'SELECT transaction_type, quantity, trading_symbol FROM order_ledger WHERE correlation_id = ?'
  ).bind(correlationId).first();

  if (status === 'FILLED' && executionPrice && order?.transaction_type === 'SELL') {
    const buyOrder = await c.env.TRADING_DB.prepare(
      `SELECT execution_price FROM order_ledger 
       WHERE trading_symbol = ? AND transaction_type = 'BUY' AND order_status = 'FILLED'
       ORDER BY created_at DESC LIMIT 1`
    ).bind(order.trading_symbol).first();

    if (buyOrder && buyOrder.execution_price) {
      pnlToUpdate = (executionPrice - (buyOrder.execution_price as number)) * (order.quantity as number);
    }
  }

  // Update D1 ledger
  await c.env.TRADING_DB.prepare(
    `UPDATE order_ledger 
     SET order_status = ?, execution_price = ?, upstox_order_id = ?, rejection_reason = ?, pnl = ?, updated_at = datetime('now')
     WHERE correlation_id = ?`
  ).bind(status, executionPrice, upstoxOrderId, rejectionReason, pnlToUpdate, correlationId).run();

  // Remove from KV pending
  await removePendingOrder(c.env.TRADING_KV, correlationId);

  // If order was REJECTED, release position lock and clear active position
  if (status === 'REJECTED' || status === 'CANCELLED') {
    const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
    if (stateRaw) {
      const state: BotState = JSON.parse(stateRaw);
      if (state.activePosition?.correlationId === correlationId) state.activePosition = null;
      if (state.activeHedgePosition?.correlationId === correlationId) state.activeHedgePosition = null;
      state.lockTimestamp = null;
      await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
    }
  }

  // If FILLED, check if it was a square-off (SELL) or entry (BUY)
  if (status === 'FILLED' && executionPrice) {
    const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
    if (stateRaw) {
      const state: BotState = JSON.parse(stateRaw);

      if (order?.transaction_type === 'SELL') {
        if (!correlationId.startsWith('SCAL-')) {
          if (state.activePosition?.correlationId === correlationId) state.activePosition = null;
          if (state.activeHedgePosition?.correlationId === correlationId) state.activeHedgePosition = null;
        }
      } else if (order?.transaction_type === 'BUY') {
        if (state.activePosition?.correlationId === correlationId) {
          state.activePosition.entryPrice = executionPrice;
        }
        if (state.activeHedgePosition?.correlationId === correlationId && state.activeHedgePosition) {
          state.activeHedgePosition.entryPrice = executionPrice;
        }
      }

      state.lockTimestamp = null;
      await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
    }
  }

  return c.json({ success: true, correlationId });
});

/**
 * POST /api/heartbeat
 * Daemon health check
 */
api.post('/api/heartbeat', requirePollSecret, async (c) => {
  await c.env.TRADING_KV.put('daemon_last_heartbeat', Date.now().toString());
  return c.json({ success: true });
});

/**
 * POST /api/escalate-order
 * DLQ for orphaned orders
 */
api.post('/api/escalate-order', requirePollSecret, async (c) => {
  const { correlationId, upstoxOrderId } = await c.req.json();

  await c.env.TRADING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS manual_intervention (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       correlation_id TEXT NOT NULL,
       upstox_order_id TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     )`
  ).run();

  await c.env.TRADING_DB.prepare(
    `INSERT INTO manual_intervention (correlation_id, upstox_order_id) VALUES (?, ?)`
  ).bind(correlationId, upstoxOrderId).run();

  return c.json({ success: true });
});

// =====================
// DASHBOARD ENDPOINTS
// =====================

/** GET /api/status — Bot state + active position + margin */
api.get('/api/status', async (c) => {
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  const state: BotState = stateRaw ? JSON.parse(stateRaw) : {
    status: 'STOPPED', lastUpdated: '', activePosition: null, lockTimestamp: null, lastMacdLine: null
  };
  const accessToken = await c.env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
  const hasToken = !!accessToken;

  // Fetch cached margin
  let marginRaw = await c.env.TRADING_KV.get(KV_KEYS.ACCOUNT_MARGIN);
  let margin = marginRaw ? JSON.parse(marginRaw) : null;

  // Dynamically refresh if missing, empty, or older than 5 minutes
  const now = Date.now();
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  if (hasToken && (!margin || !margin.timestamp || (now - margin.timestamp > CACHE_TTL_MS) || (margin.availableMargin === 0 && margin.totalBalance === 0))) {
    try {
      const funds = await getFundsAndMargin(accessToken);
      const marginData = {
        ...funds,
        timestamp: now
      };
      await c.env.TRADING_KV.put(KV_KEYS.ACCOUNT_MARGIN, JSON.stringify(marginData));
      margin = marginData;
    } catch (e) {
      // Fail silently and fallback to cached value
    }
  }

  const lastHeartbeat = await c.env.TRADING_KV.get('daemon_last_heartbeat');
  const daemonAlive = lastHeartbeat ? (now - parseInt(lastHeartbeat)) < 3 * 60 * 1000 : false;

  // Enrich activePosition and activeHedgePosition with dynamic LTP & PnL
  if (hasToken) {
    const keysToFetch: string[] = [];
    if (state.activePosition) keysToFetch.push(state.activePosition.instrumentToken);
    if (state.activeHedgePosition) keysToFetch.push(state.activeHedgePosition.instrumentToken);

    if (keysToFetch.length > 0) {
      try {
        const ltpMap = await getLTP(accessToken, keysToFetch);
        if (state.activePosition) {
          const key = state.activePosition.instrumentToken;
          const ltp = ltpMap[key] || 0;
          if (ltp > 0) {
            (state.activePosition as any).ltp = ltp;
            (state.activePosition as any).unrealizedPnL = (ltp - state.activePosition.entryPrice) * state.activePosition.quantity;
          }
        }
        if (state.activeHedgePosition) {
          const key = state.activeHedgePosition.instrumentToken;
          const ltp = ltpMap[key] || 0;
          if (ltp > 0) {
            (state.activeHedgePosition as any).ltp = ltp;
            (state.activeHedgePosition as any).unrealizedPnL = (ltp - state.activeHedgePosition.entryPrice) * state.activeHedgePosition.quantity;
          }
        }
      } catch (e) {
        // Fail silently
      }
    }
  }

  return c.json({ ...state, hasAccessToken: hasToken, margin, daemonAlive });
});

/** POST /api/control — Toggle bot status */
api.post('/api/control', async (c) => {
  const { action } = await c.req.json<{ action: string }>();
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  const state: BotState = stateRaw ? JSON.parse(stateRaw) : {
    status: 'STOPPED', lastUpdated: '', activePosition: null, lockTimestamp: null, lastMacdLine: null
  };

  if (action === 'START') state.status = 'RUNNING';
  else if (action === 'STOP') state.status = 'STOPPED';
  else if (action === 'EMERGENCY_HALT') state.status = 'EMERGENCY_HALT';
  else return c.json({ error: 'Invalid action' }, 400);

  state.lastUpdated = new Date().toISOString();
  await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));

  return c.json({ success: true, status: state.status });
});

/** POST /api/manual-entry — Forces a manual trade entry bypassing MACD */
api.post('/api/manual-entry', dashboardAuth, async (c) => {
  try {
    const { direction } = await c.req.json<{ direction: 'CE' | 'PE' }>();
    if (direction !== 'CE' && direction !== 'PE') return c.json({ error: 'Invalid direction' }, 400);

    const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
    const state: BotState = stateRaw ? JSON.parse(stateRaw) : null;
    if (!state) return c.json({ error: 'Bot state not initialized' }, 500);

    // Safety Gates
    if (state.activePosition) return c.json({ error: 'Position already active. Square off first.' }, 400);
    if (state.lockTimestamp) return c.json({ error: 'System is currently locked processing another order.' }, 400);

    const accessToken = await c.env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
    if (!accessToken) return c.json({ error: 'No active Upstox access token.' }, 400);

    // 1. Get the latest Spot Price from our database telemetry
    const lastTelemetry = await c.env.TRADING_DB.prepare(
      'SELECT nifty_spot FROM system_telemetry ORDER BY id DESC LIMIT 1'
    ).first();

    let spotPrice = (lastTelemetry?.nifty_spot as number) || 0;

    // Fallback: If telemetry is empty, fetch the live spot from Upstox candles
    if (!spotPrice) {
      const candles = await fetchNiftyCandles(accessToken, getTodayDateStr());
      if (candles.length > 0) spotPrice = candles[candles.length - 1].close;
    }
    if (!spotPrice) return c.json({ error: 'Could not determine current NIFTY Spot price' }, 500);

    // 2. Load the dynamic configuration
    const configRows = await c.env.TRADING_DB.prepare('SELECT config_key, config_value FROM bot_configuration').all();
    const configMap: Record<string, string> = {};
    for (const r of configRows.results || []) configMap[(r as any).config_key] = (r as any).config_value;

    const maxRiskPct = parseFloat(configMap['max_risk_pct'] || '100');
    const niftyLotSize = parseInt(configMap['nifty_lot_size'] || '65', 10);
    const rolloverOnExpiry = configMap['rollover_on_expiry'] === 'true';
    const strikeInterval = parseInt(configMap['strike_interval'] || '50', 10);

    // 3. Apply Cascading Strike Logic (ATM -> OTM1 -> OTM2 -> OTM3 -> OTM4)
    const rollover = shouldRollExpiry(new Date(), rolloverOnExpiry);
    const expiry = getNearestWeeklyExpiry(new Date(), rollover);
    const preferredStrikes = getPreferredStrikes(spotPrice, direction, strikeInterval, 4);

    const chain = await getOptionChain(accessToken, expiry);
    const candidateOptions = preferredStrikes.map(strike =>
      chain.find(e => e.strikePrice === strike && e.optionType === direction)
    ).filter(Boolean);

    if (candidateOptions.length === 0) return c.json({ error: `No options found for expiry ${expiry}` }, 404);

    const candidateKeys = candidateOptions.map((opt: any) => opt.instrumentKey);
    const ltpMap = await getLTP(accessToken, candidateKeys);
    const funds = await getFundsAndMargin(accessToken);

    let targetOption = null;
    let lots = 0;
    let premium = 0;
    let strike = 0;

    for (const opt of candidateOptions) {
      const currentPremium = (ltpMap as any)[(opt as any).instrumentKey]?.last_price || ltpMap[(opt as any).instrumentKey] || (opt as any).ltp;
      if (currentPremium <= 0) continue;

      const calcLots = calculateLots(funds.availableMargin, currentPremium, niftyLotSize, maxRiskPct);
      if (calcLots > 0) {
        targetOption = opt;
        lots = calcLots;
        premium = currentPremium;
        strike = (opt as any).strikePrice;
        break;
      }
    }

    if (!targetOption || lots === 0) {
      return c.json({ error: `Insufficient margin (₹${funds.availableMargin.toFixed(2)}) for ATM and all 4 OTM levels.` }, 400);
    }

    // 4. Dispatch the Order
    const quantity = lotsToQuantity(lots, niftyLotSize);
    const correlationId = generateCorrelationId();
    const bufferedPrice = Math.round((premium * 1.01) * 20) / 20;

    const order: OrderPayload = {
      orderId: crypto.randomUUID(),
      correlationId,
      instrumentToken: (targetOption as any).instrumentKey,
      tradingSymbol: (targetOption as any).tradingSymbol,
      optionType: direction,
      strikePrice: strike,
      transactionType: 'BUY',
      quantity,
      lots,
      orderPrice: bufferedPrice,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    // Push to KV for immediate local daemon pickup
    await addPendingOrder(c.env.TRADING_KV, order);

    // Log intent to D1 Database
    await c.env.TRADING_DB.prepare(
      `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(order.orderId, correlationId, order.instrumentToken, order.tradingSymbol, direction, strike, 'BUY', quantity, lots, premium, 'PENDING').run();

    // Update Bot State & Lock
    state.lockTimestamp = Date.now();
    state.activePosition = {
      correlationId,
      optionType: direction,
      instrumentToken: (targetOption as any).instrumentKey,
      tradingSymbol: (targetOption as any).tradingSymbol,
      strikePrice: strike,
      entryPrice: premium,
      quantity,
      lots,
      enteredAt: new Date().toISOString(),
    };
    await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));

    // Write a bright entry to the Execution Logs
    await c.env.TRADING_DB.prepare(
      `INSERT INTO system_telemetry (nifty_spot, atm_strike, macd_line, prev_macd_line, signal_generated, bot_status, log_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(spotPrice, strike, 0, 0, 'NONE', state.status, `MANUAL OVERRIDE: ⚡ Forced Entry -> ${(targetOption as any).tradingSymbol} × ${lots} lots`).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error('Manual entry error:', error);
    return c.json({ error: error.message || 'Manual entry failed' }, 500);
  }
});

/** POST /api/emergency-squareoff */
api.post('/api/emergency-squareoff', async (c) => {
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  if (!stateRaw) return c.json({ error: 'No bot state' }, 404);

  const state: BotState = JSON.parse(stateRaw);
  state.status = 'EMERGENCY_HALT';

  const positionsToClear = [state.activePosition, state.activeHedgePosition].filter(Boolean);

  for (const pos of positionsToClear) {
    if (pos) {
      const correlationId = `EMRG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
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
        orderPrice: 0,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await addPendingOrder(c.env.TRADING_KV, sellOrder);
      await c.env.TRADING_DB.prepare(
        `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(sellOrder.orderId, correlationId, sellOrder.instrumentToken, sellOrder.tradingSymbol, sellOrder.optionType, sellOrder.strikePrice, 'SELL', sellOrder.quantity, sellOrder.lots, 0, 'PENDING').run();
    }
  }

  state.activePosition = null;
  state.activeHedgePosition = null;
  await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
  return c.json({ success: true, message: 'Emergency halt activated for all legs' });
});

/** GET /api/telemetry — Last N telemetry entries */
api.get('/api/telemetry', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT * FROM system_telemetry ORDER BY id DESC LIMIT ?`
  ).bind(Math.min(limit, 200)).all();
  return c.json({ data: (rows.results || []).reverse() });
});

/** GET /api/orders — Order history */
api.get('/api/orders', async (c) => {
  const today = c.req.query('date') || getTodayDateStr();
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT * FROM order_ledger WHERE date(created_at) = ? ORDER BY created_at DESC`
  ).bind(today).all();
  return c.json({ data: rows.results || [] });
});

/** GET /api/trigger-cron — Manually trigger cron (DEBUG) */
import { handleScheduled } from '../cron';
api.get('/api/trigger-cron', async (c) => {
  try {
    await handleScheduled(c.env);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

import { getISTComponents, isMarketOpen, getCurrentIST } from '../lib/time';
api.get('/api/debug-time', (c) => {
  return c.json({
    now: Date.now(),
    ist: getCurrentIST().toISOString(),
    components: getISTComponents(),
    isOpen: isMarketOpen(),
  });
});

/** GET /api/chart-data — NIFTY OHLC Candles + MACD */
api.get('/api/chart-data', async (c) => {
  // 1. Get MACD telemetry from your D1 database
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT timestamp, nifty_spot, macd_line FROM system_telemetry 
     WHERE date(timestamp) = ? ORDER BY timestamp`
  ).bind(getTodayDateStr()).all();

  const telemetryData = rows.results || [];
  let spots: any[] = [];

  // 2. Try to fetch rich OHLC candles directly from Upstox
  const accessToken = await c.env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
  if (accessToken) {
    try {
      const upstoxCandles = await fetchNiftyCandles(accessToken, getTodayDateStr());
      spots = upstoxCandles.map(c => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
    } catch (e) {
      console.warn("Failed to fetch Upstox candles, falling back to telemetry.");
    }
  }

  // 3. Fallback: If Upstox fetch fails, synthesize flat candles from telemetry 
  // to prevent the dashboard from breaking.
  if (spots.length === 0) {
    spots = telemetryData.map((r: any) => ({
      timestamp: r.timestamp,
      open: r.nifty_spot,
      high: r.nifty_spot,
      low: r.nifty_spot,
      close: r.nifty_spot
    }));
  }

  return c.json({
    spots: spots,
    macd: telemetryData.map((r: any) => ({ timestamp: r.timestamp, value: r.macd_line })),
  });
});

/** GET /api/summary — Daily AI summary */
api.get('/api/summary', async (c) => {
  const date = c.req.query('date') || getTodayDateStr();
  const row = await c.env.TRADING_DB.prepare(
    `SELECT * FROM daily_summary WHERE trade_date = ?`
  ).bind(date).first();
  return c.json({ data: row || null });
});

/** GET /api/config — Bot configuration */
api.get('/api/config', async (c) => {
  const rows = await c.env.TRADING_DB.prepare('SELECT * FROM bot_configuration').all();
  const config: Record<string, string> = {};
  for (const r of rows.results || []) {
    config[(r as any).config_key] = (r as any).config_value;
  }
  return c.json({ data: config });
});

/** POST /api/config — Update bot config */
api.post('/api/config', async (c) => {
  const updates: Record<string, string> = await c.req.json();
  for (const [key, value] of Object.entries(updates)) {
    await c.env.TRADING_DB.prepare(
      `UPDATE bot_configuration SET config_value = ?, updated_at = datetime('now') WHERE config_key = ?`
    ).bind(value, key).run();
  }
  return c.json({ success: true });
});

/**
 * GET /api/config/snapshots
 * List the last 30 available configuration snapshots
 */
api.get('/api/config/snapshots', dashboardAuth, async (c) => {
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT DISTINCT snapshot_date, MAX(created_at) as created_at 
     FROM bot_configuration_history 
     GROUP BY snapshot_date 
     ORDER BY snapshot_date DESC LIMIT 30`
  ).all();
  return c.json({ data: rows.results || [] });
});

/**
 * POST /api/config/rollback
 * Instantly reverts active configuration to a historical date
 */
api.post('/api/config/rollback', dashboardAuth, async (c) => {
  const { date } = await c.req.json<{ date: string }>();
  
  // 1. Verify the snapshot exists
  const check = await c.env.TRADING_DB.prepare(
    `SELECT count(*) as count FROM bot_configuration_history WHERE snapshot_date = ?`
  ).bind(date).first();
  
  if (!check || (check as any).count === 0) {
    return c.json({ error: `No configuration snapshot found for ${date}` }, 404);
  }
  
  // 2. Wipe the current active configuration
  await c.env.TRADING_DB.prepare(`DELETE FROM bot_configuration`).run();
  
  // 3. Restore the historical configuration
  await c.env.TRADING_DB.prepare(
    `INSERT INTO bot_configuration (config_key, config_value, updated_at)
     SELECT config_key, config_value, datetime('now') 
     FROM bot_configuration_history 
     WHERE snapshot_date = ?`
  ).bind(date).run();
  
  return c.json({ success: true, message: `System configuration successfully rolled back to ${date}` });
});


// =====================
// OAUTH ENDPOINTS
// =====================

/** GET /api/auth/login — Redirect to Upstox OAuth */
api.get('/api/auth/login', (c) => {
  const url = getAuthorizationUrl(c.env.UPSTOX_CLIENT_ID, c.env.UPSTOX_REDIRECT_URI);
  return c.redirect(url);
});

/** GET /oauth/callback — Handle Upstox OAuth callback */
api.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing authorization code', 400);

  try {
    const { accessToken, expiresIn } = await exchangeCodeForToken(
      code,
      c.env.UPSTOX_CLIENT_ID,
      c.env.UPSTOX_CLIENT_SECRET,
      c.env.UPSTOX_REDIRECT_URI
    );

    await c.env.TRADING_KV.put(KV_KEYS.UPSTOX_ACCESS_TOKEN, accessToken, {
      expirationTtl: expiresIn,
    });

    return c.redirect('/');
  } catch (e: any) {
    return c.text(`Auth failed: ${e.message}`, 500);
  }
});

api.get('/api/analytics/time-of-day', dashboardAuth, async (c) => {
  const query = `
    SELECT 
      strftime('%H', exit_time) as trading_hour,
      SUM(realized_pnl) as total_pnl,
      COUNT(*) as trade_count
    FROM closed_trades 
    WHERE exit_time IS NOT NULL
    GROUP BY trading_hour
    ORDER BY trading_hour ASC
  `;
  
  try {
    const result = await c.env.TRADING_DB.prepare(query).all();
    return c.json({ data: result.results || [] });
  } catch (error) {
    // Fallback if table does not exist or errors out
    return c.json({ data: [] });
  }
});

export default api;
