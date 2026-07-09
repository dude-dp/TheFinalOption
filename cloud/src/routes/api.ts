// ============================================
// Hono API Routes — The Bridge
// Secure endpoints for daemon polling, dashboard
// ============================================

import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env, BotState, ConfirmRequest, OrderPayload, PollResponse } from '../lib/types';
import { KV_KEYS } from '../lib/types';
import { getAuthorizationUrl, exchangeCodeForToken, fetchNiftyCandles, getFundsAndMargin } from '../lib/upstox';
import { getTodayDateStr } from '../lib/time';
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
 * Returns any PENDING orders and the current access token.
 */
api.get('/api/poll', requirePollSecret, async (c) => {
  const kv = c.env.TRADING_KV;

  // Get bot state
  const stateRaw = await kv.get(KV_KEYS.BOT_STATE);
  const state: BotState = stateRaw ? JSON.parse(stateRaw) : { status: 'STOPPED' };

  // Get pending orders array from KV
  const rawPending = await kv.get(KV_KEYS.PENDING_ORDERS);
  const pendingList: OrderPayload[] = rawPending ? JSON.parse(rawPending) : [];
  
  const orders: OrderPayload[] = [];
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
  const accessToken = await kv.get(KV_KEYS.UPSTOX_ACCESS_TOKEN);

  const response: PollResponse = {
    hasOrders: orders.length > 0,
    orders,
    accessToken,
    botStatus: state.status || 'STOPPED',
  };

  return c.json(response);
});

/**
 * GET /api/unresolved-orders
 * Local daemon polls this every 15s to clean up 'Phantom Orders'
 */
api.get('/api/unresolved-orders', requirePollSecret, async (c) => {
  // Find orders that were dispatched but never reached a final state
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT correlation_id, upstox_order_id, order_status 
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

  // Update D1 ledger
  await c.env.TRADING_DB.prepare(
    `UPDATE order_ledger 
     SET order_status = ?, execution_price = ?, upstox_order_id = ?, rejection_reason = ?, updated_at = datetime('now')
     WHERE correlation_id = ?`
  ).bind(status, executionPrice, upstoxOrderId, rejectionReason, correlationId).run();

  // Remove from KV pending
  await removePendingOrder(c.env.TRADING_KV, correlationId);

  // If order was REJECTED, release position lock and clear active position
  if (status === 'REJECTED' || status === 'CANCELLED') {
    const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
    if (stateRaw) {
      const state: BotState = JSON.parse(stateRaw);
      if (state.activePosition?.correlationId === correlationId) {
        state.activePosition = null;
      }
      state.lockTimestamp = null;
      await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
    }
  }

  // If FILLED, check if it was a square-off (SELL) or entry (BUY)
  if (status === 'FILLED' && executionPrice) {
    const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
    if (stateRaw) {
      const state: BotState = JSON.parse(stateRaw);

      // Look up the original order type from D1 to know if this was a BUY or SELL
      const order = await c.env.TRADING_DB.prepare(
        'SELECT transaction_type FROM order_ledger WHERE correlation_id = ?'
      ).bind(correlationId).first();

      if (order?.transaction_type === 'SELL') {
        // It was a successful square-off. Now it's safe to clear the position.
        state.activePosition = null;
      } else if (order?.transaction_type === 'BUY' && state.activePosition?.correlationId === correlationId) {
        // It was an entry. Update entry price.
        state.activePosition.entryPrice = executionPrice;
      }

      state.lockTimestamp = null;
      await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
    }
  }

  return c.json({ success: true, correlationId });
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

  return c.json({ ...state, hasAccessToken: hasToken, margin });
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

/** POST /api/emergency-squareoff */
api.post('/api/emergency-squareoff', async (c) => {
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  if (!stateRaw) return c.json({ error: 'No bot state' }, 404);

  const state: BotState = JSON.parse(stateRaw);
  state.status = 'EMERGENCY_HALT';

  if (state.activePosition) {
    const correlationId = `EMRG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const sellOrder: OrderPayload = {
      orderId: crypto.randomUUID(),
      correlationId,
      instrumentToken: state.activePosition.instrumentToken,
      tradingSymbol: state.activePosition.tradingSymbol,
      optionType: state.activePosition.optionType,
      strikePrice: state.activePosition.strikePrice,
      transactionType: 'SELL',
      quantity: state.activePosition.quantity,
      lots: state.activePosition.lots,
      orderPrice: 0,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    await addPendingOrder(c.env.TRADING_KV, sellOrder);

    await c.env.TRADING_DB.prepare(
      `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(sellOrder.orderId, correlationId, sellOrder.instrumentToken, sellOrder.tradingSymbol, sellOrder.optionType, sellOrder.strikePrice, 'SELL', sellOrder.quantity, sellOrder.lots, 0, 'PENDING').run();

    state.activePosition = null;
  }

  await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
  return c.json({ success: true, message: 'Emergency halt activated' });
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

export default api;
