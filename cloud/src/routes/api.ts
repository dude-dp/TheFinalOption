// ============================================
// Hono API Routes — The Bridge
// Secure endpoints for daemon polling, dashboard
// ============================================

import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env, BotState, ConfirmRequest, OrderPayload, PollResponse } from '../lib/types';
import { KV_KEYS } from '../lib/types';
import { getAuthorizationUrl, exchangeCodeForToken, fetchNiftyCandles, getOptionChain, getLTP, getFundsAndMargin, fetchHistoricalCandlesRange, notifyDiscord } from '../lib/upstox';
import { getPreferredStrikes, shouldRollExpiry, getNearestWeeklyExpiry } from '../lib/strike';
import { calculateLots, lotsToQuantity } from '../lib/lot-sizing';
import { getTodayDateStr, generateCorrelationId } from '../lib/time';
import { addPendingOrder, removePendingOrder } from '../lib/orders';
import { executePaperTrade } from '../lib/paper';
import { calculateMACD } from '../lib/macd';
import { calculateATRArray } from '../lib/atr';

const api = new Hono<{ Bindings: Env }>();

// Holds active, persistent WebSocket connections to the local daemon
const daemonWebSockets = new Set<WebSocket>();

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
 * GET /api/ws
 * 🚀 TASK 4.2: Ultra-low latency WebSocket stream.
 * The local daemon connects here to receive instant execution fills.
 */
api.get('/api/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  const secret = c.req.query('secret');
  if (secret !== c.env.POLL_SECRET) {
    return c.text('Unauthorized', 401);
  }

  // Cloudflare native WebSocketPair initialization
  const webSocketPair = new WebSocketPair();
  const client = webSocketPair[0];
  const server = webSocketPair[1];

  server.accept();
  daemonWebSockets.add(server);

  server.addEventListener('close', () => daemonWebSockets.delete(server));
  server.addEventListener('error', () => daemonWebSockets.delete(server));

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
});

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
    // 🚨 RACE CONDITION FIX: Fetch the absolute latest state again right before writing
    // This ensures we don't accidentally overwrite a "RUNNING" status that the UI just set.
    const latestStateRaw = await kv.get(KV_KEYS.BOT_STATE);
    const latestState: BotState = latestStateRaw ? JSON.parse(latestStateRaw) : state;

    latestState.daemonMetrics = {
      reqPerSecond: body.rateMetrics.reqPerSecond,
      reqPerMinute: body.rateMetrics.reqPerMinute,
      lastUpdated: Date.now()
    };
    
    await kv.put(KV_KEYS.BOT_STATE, JSON.stringify(latestState));
    // 🚨 UPDATE THE ACTUAL HEARTBEAT KEY THE CRON JOB CHECKS
    await kv.put('daemon_last_heartbeat', Date.now().toString());
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
 * POST /api/sweep-orphans
 * Local daemon polls this every 15s to clean up 'Phantom Orders'
 */
api.post('/api/sweep-orphans', async (c) => {
  const body = await c.req.json<{ secret: string }>();
  if (body.secret !== c.env.POLL_SECRET) return c.json({ error: 'Unauthorized' }, 401);

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
  let profitPct = 0;
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
      const buyPrice = buyOrder.execution_price as number;
      pnlToUpdate = (executionPrice - buyPrice) * (order.quantity as number);
      profitPct = ((executionPrice - buyPrice) / buyPrice) * 100;
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

        if (profitPct >= 15.0) {
          state.lastProfitableTradeId = correlationId;
          state.lastProfitPct = profitPct;
        }

        // ==========================================
        // VOICE ALERT: EXIT NOTIFICATION
        // ==========================================
        if (pnlToUpdate < 0) {
          state.lastVoiceAlert = `Warning. Stop loss hit. Position closed at ${executionPrice.toFixed(2)}.`;
        } else {
          state.lastVoiceAlert = `Target reached. Position closed in profit at ${executionPrice.toFixed(2)}.`;
        }
        state.lastVoiceAlertId = `${correlationId}-SELL`;

      } else if (order?.transaction_type === 'BUY') {
        if (state.activePosition?.correlationId === correlationId) {
          state.activePosition.entryPrice = executionPrice;
        }
        if (state.activeHedgePosition?.correlationId === correlationId && state.activeHedgePosition) {
          state.activeHedgePosition.entryPrice = executionPrice;
        }

        // ==========================================
        // VOICE ALERT: ENTRY NOTIFICATION
        // ==========================================
        const optionName = order.option_type === 'CE' ? 'Calls' : 'Puts';
        state.lastVoiceAlert = `Executing Buy. ${order.quantity} Nifty ${optionName} at ${executionPrice.toFixed(2)}.`;
        state.lastVoiceAlertId = `${correlationId}-BUY`;
      }

      state.lockTimestamp = null;
      await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
    }
  }

  // ========================================================================
  // 🚀 TASK 4.2: ZERO-LATENCY WEBSOCKET PUSH
  // Push the Realized PnL and Fill Data down to the daemon instantly.
  // ========================================================================
  const syncPayload = JSON.stringify({
    type: 'EXECUTION_CONFIRMATION',
    correlationId,
    status,
    executionPrice,
    filledQuantity,
    pnl: pnlToUpdate,
    transactionType: order?.transaction_type || 'UNKNOWN',
    timestamp: Date.now()
  });

  daemonWebSockets.forEach((ws) => {
    try {
      ws.send(syncPayload);
    } catch (err) {
      daemonWebSockets.delete(ws);
    }
  });

  return c.json({ success: true, correlationId });
});

/**
 * POST /api/heartbeat
 * Daemon health check
 */
api.post('/api/heartbeat', async (c) => {
  const body = await c.req.json<{ secret: string }>();
  if (body.secret !== c.env.POLL_SECRET) return c.json({ error: 'Unauthorized' }, 401);

  await c.env.TRADING_KV.put('daemon_last_heartbeat', Date.now().toString());
  return c.json({ success: true });
});

/**
 * POST /api/dlq
 * DLQ for orphaned orders
 */
api.post('/api/dlq', async (c) => {
  const { correlationId, upstoxOrderId } = await c.req.json<{ correlationId: string; upstoxOrderId: string; secret?: string }>();

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

  // Calculate today's realized PnL
  const today = getTodayDateStr();
  let todayRealizedPnL = 0;
  try {
    const pnlRow = await c.env.TRADING_DB.prepare(
      `SELECT SUM(pnl) as daily_pnl FROM order_ledger WHERE date(updated_at) = ? AND pnl IS NOT NULL AND pnl != 0`
    ).bind(today).first();
    if (pnlRow && pnlRow.daily_pnl) {
      todayRealizedPnL = parseFloat(pnlRow.daily_pnl as any) || 0;
    }
  } catch (e) {
    console.error("Failed to fetch daily PnL:", e);
  }

  return c.json({ ...state, hasAccessToken: hasToken, margin, daemonAlive, todayRealizedPnL });
});

/** POST /api/control — Toggle bot status */
api.post('/api/control', async (c) => {
  const { action, mode, reason } = await c.req.json<{ action: string, mode?: 'LIVE' | 'PAPER', reason?: string }>();
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  const state: BotState = stateRaw ? JSON.parse(stateRaw) : {
    status: 'STOPPED', lastUpdated: '', activePosition: null, lockTimestamp: null, lastMacdLine: null
  };

  if (action === 'START') state.status = 'RUNNING';
  else if (action === 'STOP') state.status = 'STOPPED';
  else if (action === 'EMERGENCY_HALT') {
    state.status = 'EMERGENCY_HALT';
    if (reason && c.env.DISCORD_WEBHOOK_URL) {
      await notifyDiscord(c.env.DISCORD_WEBHOOK_URL, `✅ **CIRCUIT BREAKER TRIPPED**\n${reason}`);
    }
  }
  else if (action === 'SET_MODE' && mode) state.tradingMode = mode;
  else return c.json({ error: 'Invalid action' }, 400);

  state.lastUpdated = new Date().toISOString();
  await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));

  return c.json({ success: true, status: state.status, mode: state.tradingMode });
});
/** 
 * POST /api/position/sl-override 
 * Accepts manual drag-and-drop Stop Loss updates from the UI 
 */
api.post('/api/position/sl-override', dashboardAuth, async (c) => {
  const { type, price } = await c.req.json<{ type: 'HARD' | 'TRAILING', price: number }>();

  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  if (!stateRaw) return c.json({ error: 'No bot state found' }, 404);

  const state: BotState = JSON.parse(stateRaw);

  if (!state.activePosition) {
    return c.json({ error: 'No active position to modify' }, 400);
  }

  // Cap the precision to 2 decimal places (standard tick size)
  const formattedPrice = Math.round(price * 20) / 20;

  if (type === 'HARD') {
    state.activePosition.manualHardSL = formattedPrice;
  } else if (type === 'TRAILING') {
    state.activePosition.manualTrailingSL = formattedPrice;
  }

  state.lastUpdated = new Date().toISOString();
  state.lastVoiceAlert = `Manual override accepted. Dragged ${type} Stop Loss to ${formattedPrice.toFixed(2)}.`;
  state.lastVoiceAlertId = `manual-override-${Date.now()}`;
  await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));

  // Log an audit trail entry so you know a human touched it
  await c.env.TRADING_DB.prepare(
    `INSERT INTO system_telemetry (nifty_spot, atm_strike, macd_line, prev_macd_line, signal_generated, bot_status, log_message) 
     VALUES (0, 0, 0, 0, 'NONE', ?, ?)`
  ).bind(state.status, `MANUAL OVERRIDE: 🖐️ Dragged ${type} SL to ₹${formattedPrice.toFixed(2)}`).run();

  return c.json({ success: true, newPrice: formattedPrice });
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

    const isPaperMode = state.tradingMode === 'PAPER';

    if (isPaperMode) {
      await executePaperTrade(c.env, order, premium);

      await c.env.TRADING_DB.prepare(
        `INSERT INTO system_telemetry (nifty_spot, atm_strike, macd_line, prev_macd_line, signal_generated, bot_status, log_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(spotPrice, strike, 0, 0, 'NONE', state.status, `[PAPER MODE] MANUAL OVERRIDE: ⚡ Forced Entry -> ${(targetOption as any).tradingSymbol} × ${lots} lots`).run();
    } else {
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
    }

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

  const isPaperMode = state.tradingMode === 'PAPER';
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

      if (isPaperMode) {
        // Fetch last price or use entry price as fallback
        let currentLtpToUse = 0;
        const accessToken = await c.env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
        if (accessToken) {
          try {
            const ltpData = await getLTP(accessToken, [pos.instrumentToken]);
            currentLtpToUse = ltpData[pos.instrumentToken] || pos.entryPrice || 0;
          } catch (e) {
            currentLtpToUse = pos.entryPrice || 0;
          }
        } else {
          currentLtpToUse = pos.entryPrice || 0;
        }

        await executePaperTrade(c.env, sellOrder, currentLtpToUse);

        await c.env.TRADING_DB.prepare(
          `INSERT INTO system_telemetry (nifty_spot, atm_strike, macd_line, prev_macd_line, signal_generated, bot_status, log_message)
           VALUES (0, 0, 0, 0, 'NONE', ?, ?)`
        ).bind(state.status, `[PAPER MODE] EMERGENCY HALT: Square off ${pos.tradingSymbol} @ ₹${currentLtpToUse.toFixed(2)}`).run();
      } else {
        await addPendingOrder(c.env.TRADING_KV, sellOrder);
        await c.env.TRADING_DB.prepare(
          `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(sellOrder.orderId, correlationId, sellOrder.instrumentToken, sellOrder.tradingSymbol, sellOrder.optionType, sellOrder.strikePrice, 'SELL', sellOrder.quantity, sellOrder.lots, 0, 'PENDING').run();
      }
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

/** POST /api/orders/journal - Update tags and notes for a specific trade */
api.post('/api/orders/journal', dashboardAuth, async (c) => {
  const { correlationId, tags, notes } = await c.req.json<{ correlationId: string, tags: string, notes: string }>();

  if (!correlationId) return c.json({ error: 'Missing correlation ID' }, 400);

  await c.env.TRADING_DB.prepare(
    `UPDATE order_ledger 
     SET tags = ?, notes = ?, updated_at = datetime('now') 
     WHERE correlation_id = ?`
  ).bind(tags, notes, correlationId).run();

  return c.json({ success: true });
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
api.get('/api/chart-data', dashboardAuth, async (c) => {
  // 1. Fetch the most recent 3000 candles (Roughly 8 trading days) from D1.
  // By ordering DESC and limiting, we ALWAYS get data, even on weekends.
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT * FROM nifty_candles ORDER BY timestamp DESC LIMIT 3000`
  ).all();

  // Reverse them back to ASC so the chart draws from left to right
  let spots = rows.results ? rows.results.reverse() : [];

  // 2. Fetch MACD telemetry for the dashboard signals
  const macdRows = await c.env.TRADING_DB.prepare(
    `SELECT timestamp, nifty_spot, macd_line FROM system_telemetry 
     ORDER BY timestamp DESC LIMIT 3000`
  ).all();

  const macdResults = macdRows.results ? macdRows.results.reverse() : [];

  return c.json({
    spots: spots,
    macd: macdResults.map((r: any) => ({ timestamp: r.timestamp, value: r.macd_line })),
  });
});

/** * POST /api/admin/backfill 
 * WAF-Bypass: Uses the Intraday endpoint instead of historical date ranges.
 */
api.post('/api/admin/backfill', dashboardAuth, async (c) => {
  const accessToken = await c.env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);
  if (!accessToken) return c.json({ error: 'No Upstox token found. Please login first.' }, 401);

  try {
    // fetchNiftyCandles uses the safe /intraday/ endpoint which bypasses the strict historical WAF
    const candles = await fetchNiftyCandles(accessToken, getTodayDateStr());
    
    if (!candles || candles.length === 0) {
      return c.json({ error: 'No intraday data returned from Upstox.' }, 400);
    }

    const statements = [];
    for (const candle of candles) {
      statements.push(
        c.env.TRADING_DB.prepare(
          `INSERT OR IGNORE INTO nifty_candles (timestamp, open, high, low, close, volume) 
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume)
      );
    }

    const CHUNK_SIZE = 100;
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      const chunk = statements.slice(i, i + CHUNK_SIZE);
      await c.env.TRADING_DB.batch(chunk);
    }

    return c.json({ 
      success: true, 
      message: `Successfully seeded ${candles.length} recent intraday candles! Chart is ready.` 
    });

  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/admin/sync-candle
 * Called by local daemon to push newly closed 1-minute candles.
 */
api.post('/api/admin/sync-candle', async (c) => {
  const body = await c.req.json<{ secret: string; candle: any }>();
  if (body.secret !== c.env.POLL_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { timestamp, open, high, low, close, volume } = body.candle;
  
  try {
    await c.env.TRADING_DB.prepare(
      `INSERT OR IGNORE INTO nifty_candles (timestamp, open, high, low, close, volume) 
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      new Date(timestamp).toISOString(), 
      open, 
      high, 
      low, 
      close, 
      volume || 0
    ).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
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

api.get('/api/analytics/drawdown', dashboardAuth, async (c) => {
  // 1. Fetch daily realized PnL from the order ledger
  const query = `
    SELECT 
      date(updated_at) as trade_date,
      SUM(pnl) as daily_pnl
    FROM order_ledger 
    WHERE pnl IS NOT NULL AND pnl != 0
    GROUP BY trade_date
    ORDER BY trade_date ASC
  `;

  try {
    const rows = await c.env.TRADING_DB.prepare(query).all();

    let cumulativePnL = 0;
    let highWaterMark = 0;
    const drawdownData = [];

    // 2. Step through time to build the Equity Curve and Drawdown
    for (const row of rows.results || []) {
      cumulativePnL += (row.daily_pnl as number);

      // If we hit a new all-time high, update the High Water Mark
      if (cumulativePnL > highWaterMark) {
        highWaterMark = cumulativePnL;
      }

      // Drawdown is the negative distance from the peak
      const drawdown = cumulativePnL - highWaterMark;

      drawdownData.push({
        date: row.trade_date,
        drawdown: drawdown, // Will always be <= 0
        cumulative: cumulativePnL,
        peak: highWaterMark
      });
    }

    return c.json({ data: drawdownData });
  } catch (error) {
    console.error("Drawdown calculation failed:", error);
    return c.json({ data: [] });
  }
});

api.get('/api/analytics/slippage', dashboardAuth, async (c) => {
  // Fetch filled orders that have both expected and execution prices
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT 
       date(created_at) as date, 
       created_at,
       transaction_type, 
       order_price, 
       execution_price 
     FROM order_ledger 
     WHERE order_status = 'FILLED' 
       AND execution_price > 0 
       AND order_price > 0
     ORDER BY created_at ASC LIMIT 100`
  ).all();

  let totalSlippagePct = 0;
  let count = 0;
  const timeline: any[] = [];

  for (const row of rows.results || []) {
    let slippagePct = 0;

    // Normalize Slippage: Positive values = Bad (Lost Money), Negative values = Good (Price Improvement)
    if (row.transaction_type === 'BUY') {
      // Bought for higher than expected = Bad
      slippagePct = (((row.execution_price as number) - (row.order_price as number)) / (row.order_price as number)) * 100;
    } else {
      // Sold for lower than expected = Bad
      slippagePct = (((row.order_price as number) - (row.execution_price as number)) / (row.order_price as number)) * 100;
    }

    totalSlippagePct += slippagePct;
    count++;

    timeline.push({
      time: new Date((row as any).created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: row.date,
      slippage: slippagePct,
      type: row.transaction_type
    });
  }

  const avgSlippage = count > 0 ? (totalSlippagePct / count) : 0;

  return c.json({ avgSlippage, timeline });
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

api.get('/api/analytics/ratios', dashboardAuth, async (c) => {
  // 1. Fetch Daily Realized PnL
  const query = `
    SELECT 
      date(updated_at) as trade_date,
      SUM(pnl) as daily_pnl
    FROM order_ledger 
    WHERE pnl IS NOT NULL AND pnl != 0
    GROUP BY trade_date
    ORDER BY trade_date ASC
  `;

  try {
    const rows = await c.env.TRADING_DB.prepare(query).all();
    const dailyPnL = (rows.results || []).map((r: any) => parseFloat(r.daily_pnl) || 0);

    if (dailyPnL.length === 0) {
      return c.json({ sharpe: "0.00", sortino: "0.00", calmar: "0.00" });
    }

    const n = dailyPnL.length;
    const meanPnL = dailyPnL.reduce((a, b) => a + b, 0) / n;

    // 2. Standard Deviation (Sharpe Risk)
    const variance = dailyPnL.reduce((a, b) => a + Math.pow(b - meanPnL, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // 3. Downside Deviation (Sortino Risk)
    // MAR (Minimum Acceptable Return) is assumed to be 0 for absolute PnL tracking
    const downsideVariance = dailyPnL.reduce((a, b) => {
      return b < 0 ? a + Math.pow(b, 2) : a;
    }, 0) / n;
    const downsideStdDev = Math.sqrt(downsideVariance);

    // 4. Maximum Drawdown (Calmar Risk)
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;

    for (const pnl of dailyPnL) {
      cumulative += pnl;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // 5. Annualization Multipliers (252 trading days in a year)
    const annualFactor = Math.sqrt(252);
    const annualizedReturn = meanPnL * 252;

    // 6. Calculate Ratios
    const sharpe = stdDev === 0 ? 0 : (meanPnL / stdDev) * annualFactor;
    const sortino = downsideStdDev === 0 ? 0 : (meanPnL / downsideStdDev) * annualFactor;
    const calmar = maxDrawdown === 0 ? 0 : (annualizedReturn / maxDrawdown);

    return c.json({
      sharpe: sharpe.toFixed(2),
      sortino: sortino.toFixed(2),
      calmar: calmar.toFixed(2)
    });

  } catch (error) {
    console.error("Ratio calculation failed:", error);
    return c.json({ sharpe: "0.00", sortino: "0.00", calmar: "0.00" });
  }
});

api.get('/api/analytics/monte-carlo-stats', dashboardAuth, async (c) => {
  // Fetch all historical closed trades
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT pnl FROM order_ledger WHERE pnl IS NOT NULL AND pnl != 0`
  ).all();

  const trades = (rows.results || []).map((r: any) => parseFloat(r.pnl));
  if (trades.length < 10) {
    return c.json({ error: 'Need at least 10 trades to generate a reliable statistical baseline' }, 400);
  }

  const wins = trades.filter(t => t > 0);
  const losses = trades.filter(t => t < 0);

  const winRate = wins.length / trades.length;

  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  // Calculate Variance / Standard Deviation to inject real-world randomness into the simulation
  const winVariance = wins.reduce((a, b) => a + Math.pow(b - avgWin, 2), 0) / (wins.length || 1);
  const lossVariance = losses.reduce((a, b) => a + Math.pow(b - avgLoss, 2), 0) / (losses.length || 1);

  return c.json({
    winRate,
    avgWin,
    avgLoss,
    winStdDev: Math.sqrt(winVariance),
    lossStdDev: Math.sqrt(lossVariance),
    totalTrades: trades.length
  });
});

/** POST /api/admin/run-backtest */
api.post('/api/admin/run-backtest', dashboardAuth, async (c) => {
  const { days = 30 } = await c.req.json<{ days?: number }>();

  // 1. Fetch historical NIFTY Spot candles
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT * FROM nifty_candles 
     WHERE timestamp >= datetime('now', ?) 
     ORDER BY timestamp ASC`
  ).bind(`-${days} days`).all();

  const candles = rows.results as any[];
  if (!candles || candles.length < 100) {
    return c.json({ error: 'Insufficient historical data. Please run the Backfill utility first.' }, 400);
  }

  // 2. Calculate Indicators over the entire dataset
  const closes = candles.map(c => c.close);
  const macdResult = calculateMACD(closes);
  const atrResult = calculateATRArray(candles, 14);

  // Align indicator arrays to match candles 1-to-1
  const macdLine = new Array(candles.length).fill(0);
  for (let j = 0; j < macdResult.macdLine.length; j++) {
    macdLine[j + 25] = macdResult.macdLine[j];
  }

  const hist = new Array(candles.length).fill(0);
  for (let j = 0; j < macdResult.histogram.length; j++) {
    hist[j + 33] = macdResult.histogram[j];
  }

  // 3. Simulation Variables & Constants
  let activeTrades: any[] = []; // Changed to array to support multi-leg Straddles
  const closedTrades: any[] = [];

  let cumulativePnL = 0;
  let peakPnL = 0;
  let maxDrawdown = 0;
  let dailyPnL = 0;
  let currentDayStr = '';

  let cumVol = 0;
  let cumVolPrice = 0;

  const NIFTY_LOT_SIZE = 75;
  const LOTS_TO_TRADE = 2;
  const ASSUMED_DELTA = 0.5; // ATM Option approximation
  const STARTING_MARGIN = 100000; // Simulated 1L capital
  const MAX_DAILY_LOSS = -(STARTING_MARGIN * 0.05); // -5% Drawdown Shield

  // 4. The Execution Loop
  for (let i = 35; i < candles.length; i++) {
    const candle = candles[i];
    const prevMacd = macdLine[i - 1];
    const currMacd = macdLine[i];
    const atr = atrResult[i] || 20;

    // A. DAILY RESETS & VWAP CALCULATION
    const dateObj = new Date(candle.timestamp);
    const dayStr = dateObj.toISOString().split('T')[0];

    if (dayStr !== currentDayStr) {
      currentDayStr = dayStr;
      dailyPnL = 0; // Reset Drawdown shield
      cumVol = 0;   // Reset VWAP
      cumVolPrice = 0;
    }

    cumVol += candle.volume || 1;
    cumVolPrice += candle.close * (candle.volume || 1);
    const currentVwap = cumVolPrice / cumVol;

    // Time Math (IST)
    let istHours = dateObj.getUTCHours() + (dateObj.getUTCMinutes() / 60) + 5.5;
    if (istHours >= 24) istHours -= 24;

    const isThetaDeathZone = istHours >= 12.5 && istHours <= 14.0;
    const isEOD = istHours >= 15.25;
    const isDrawdownBreached = dailyPnL <= MAX_DAILY_LOSS;

    // Detect Momentum Decay (3 consecutive declining histogram bars)
    let isMomentumDecayingCE = false;
    let isMomentumDecayingPE = false;
    const h3 = hist[i - 3], h2 = hist[i - 2], h1 = hist[i - 1];
    if (h3 > 0 && h2 > 0 && h1 > 0 && h3 > h2 && h2 > h1) isMomentumDecayingCE = true;
    if (h3 < 0 && h2 < 0 && h1 < 0 && h3 < h2 && h2 < h1) isMomentumDecayingPE = true;

    // B. EXIT LOGIC (Loop backwards to safely remove from array)
    for (let j = activeTrades.length - 1; j >= 0; j--) {
      const trade = activeTrades[j];
      trade.highestSpot = Math.max(trade.highestSpot, candle.high);
      trade.lowestSpot = Math.min(trade.lowestSpot, candle.low);

      let tslSpotPrice = 0;
      let isStoppedOut = false;
      let spotPointsCaptured = 0;

      // 1. Scale-Out Logic (Free Ride at 2.5 * ATR)
      const currentProfitPoints = trade.type === 'CE' ? (candle.high - trade.entryPrice) : (trade.entryPrice - candle.low);
      if (!trade.scaleOutDone && trade.lots > 1 && currentProfitPoints >= (2.5 * atr)) {
        trade.scaleOutDone = true;
        const lotsToSell = Math.floor(trade.lots / 2);
        trade.lots -= lotsToSell;

        const partialPnl = (currentProfitPoints * ASSUMED_DELTA) * (lotsToSell * NIFTY_LOT_SIZE);
        cumulativePnL += partialPnl;
        dailyPnL += partialPnl;

        closedTrades.push({
          type: trade.type, entryTime: trade.entryTime, exitTime: candle.timestamp,
          entrySpot: trade.entryPrice.toFixed(2), exitSpot: candle.close.toFixed(2),
          reason: 'Scale-Out (50%)', pnl: partialPnl, cumulative: cumulativePnL
        });
      }

      // 2. Dynamic TSL Logic (w/ Momentum Decay tighten)
      if (trade.type === 'CE') {
        tslSpotPrice = trade.highestSpot - (1.5 * atr);
        if (isMomentumDecayingCE && (candle.close - trade.entryPrice) > (0.5 * atr)) {
          tslSpotPrice = Math.max(tslSpotPrice, candle.close - (0.5 * atr));
        }
        if (candle.low <= tslSpotPrice) isStoppedOut = true;
      } else {
        tslSpotPrice = trade.lowestSpot + (1.5 * atr);
        if (isMomentumDecayingPE && (trade.entryPrice - candle.close) > (0.5 * atr)) {
          tslSpotPrice = Math.min(tslSpotPrice, candle.close + (0.5 * atr));
        }
        if (candle.high >= tslSpotPrice) isStoppedOut = true;
      }

      // 3. Reversal Logic
      const reversalExit = (trade.type === 'CE' && prevMacd > 0 && currMacd < 0) ||
        (trade.type === 'PE' && prevMacd < 0 && currMacd > 0);

      // Execute Exit
      if (isStoppedOut || reversalExit || isEOD) {
        spotPointsCaptured = trade.type === 'CE' ? (candle.close - trade.entryPrice) : (trade.entryPrice - candle.close);
        const premiumPoints = spotPointsCaptured * ASSUMED_DELTA;
        const pnl = premiumPoints * (NIFTY_LOT_SIZE * trade.lots);

        cumulativePnL += pnl;
        dailyPnL += pnl;

        if (cumulativePnL > peakPnL) peakPnL = cumulativePnL;
        const currentDrawdown = peakPnL - cumulativePnL;
        if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;

        let reason = isEOD ? 'EOD Squareoff' : (reversalExit ? 'MACD Reversal' : 'Trailing SL');
        if (isStoppedOut && (trade.type === 'CE' ? isMomentumDecayingCE : isMomentumDecayingPE)) reason += ' (Momentum Decay)';

        closedTrades.push({
          type: trade.type, entryTime: trade.entryTime, exitTime: candle.timestamp,
          entrySpot: trade.entryPrice.toFixed(2), exitSpot: candle.close.toFixed(2),
          reason: reason, pnl: pnl, cumulative: cumulativePnL
        });

        activeTrades.splice(j, 1);
      }
    }

    // C. ENTRY LOGIC
    if (activeTrades.length === 0 && !isDrawdownBreached && !isThetaDeathZone && !isEOD) {

      const isBullishCross = prevMacd < 0 && currMacd > 0;
      const isBearishCross = prevMacd > 0 && currMacd < 0;

      if (isBullishCross || isBearishCross) {

        // Mock ADX for backtester (If you have calculateADXArray, use actual ADX here)
        // Assume random/mocked ADX < 20 for Straddle demonstration. In production, connect your real ADX output.
        const simulatedAdx = 25; // Change this to actual adxResult[i] if integrated

        if (simulatedAdx < 20) {
          // STRADDLE ENTRY (Choppy Market)
          activeTrades.push({ type: 'CE', lots: LOTS_TO_TRADE / 2, entryTime: candle.timestamp, entryPrice: candle.close, highestSpot: candle.close, lowestSpot: candle.close, scaleOutDone: false });
          activeTrades.push({ type: 'PE', lots: LOTS_TO_TRADE / 2, entryTime: candle.timestamp, entryPrice: candle.close, highestSpot: candle.close, lowestSpot: candle.close, scaleOutDone: false });
        } else {
          // VWAP Mean Reversion Extension Filter
          const extensionPct = ((candle.close - currentVwap) / currentVwap) * 100;

          if (isBullishCross && extensionPct <= 1.0) {
            activeTrades.push({ type: 'CE', lots: LOTS_TO_TRADE, entryTime: candle.timestamp, entryPrice: candle.close, highestSpot: candle.close, lowestSpot: candle.close, scaleOutDone: false });
          }
          else if (isBearishCross && extensionPct >= -1.0) {
            activeTrades.push({ type: 'PE', lots: LOTS_TO_TRADE, entryTime: candle.timestamp, entryPrice: candle.close, highestSpot: candle.close, lowestSpot: candle.close, scaleOutDone: false });
          }
        }
      }
    }
  }

  // 5. Aggregate Statistics
  const winningTrades = closedTrades.filter(t => t.pnl > 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

  return c.json({
    success: true,
    totalTrades: closedTrades.length,
    winRate: winRate,
    totalPnL: cumulativePnL,
    maxDrawdown: maxDrawdown,
    trades: closedTrades.reverse() // Newest first for the table
  });
});

export default api;
