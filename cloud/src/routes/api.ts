// ============================================
// Hono API Routes — The Bridge
// Secure endpoints for daemon polling, dashboard
// ============================================

import { Hono } from 'hono';
import type { Env, BotState, ConfirmRequest, OrderPayload, PollResponse } from '../lib/types';
import { KV_KEYS } from '../lib/types';
import { getAuthorizationUrl, exchangeCodeForToken } from '../lib/upstox';
import { getTodayDateStr } from '../lib/time';

const api = new Hono<{ Bindings: Env }>();

// --- Middleware: Poll Secret Auth ---

function requirePollSecret(c: any, next: any) {
  const secret = c.req.header('X-Poll-Secret');
  if (secret !== c.env.POLL_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

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

  // List all pending orders from KV
  const listResult = await kv.list({ prefix: KV_KEYS.PENDING_ORDER_PREFIX });
  const orders: OrderPayload[] = [];

  for (const key of listResult.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      const order: OrderPayload = JSON.parse(raw);
      if (order.status === 'PENDING') {
        orders.push(order);
        // Mark as DISPATCHED to prevent duplicate pickup
        order.status = 'DISPATCHED';
        await kv.put(key.name, JSON.stringify(order), { expirationTtl: 300 });
        // Update D1
        await c.env.TRADING_DB.prepare(
          `UPDATE order_ledger SET order_status = 'DISPATCHED', updated_at = datetime('now') WHERE correlation_id = ?`
        ).bind(order.correlationId).run();
      }
    }
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
  await c.env.TRADING_KV.delete(`${KV_KEYS.PENDING_ORDER_PREFIX}${correlationId}`);

  // If order was REJECTED, release position lock and clear active position
  if (status === 'REJECTED' || status === 'CANCELLED') {
    const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
    if (stateRaw) {
      const state: BotState = JSON.parse(stateRaw);
      if (state.activePosition?.correlationId === correlationId) {
        state.activePosition = null;
      }
      state.positionLock = false;
      await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
    }
  }

  // If FILLED BUY, update entry price in bot state
  if (status === 'FILLED' && executionPrice) {
    const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
    if (stateRaw) {
      const state: BotState = JSON.parse(stateRaw);
      if (state.activePosition?.correlationId === correlationId) {
        state.activePosition.entryPrice = executionPrice;
      }
      state.positionLock = false;
      await c.env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
    }
  }

  return c.json({ success: true, correlationId });
});

// =====================
// DASHBOARD ENDPOINTS
// =====================

/** GET /api/status — Bot state + active position */
api.get('/api/status', async (c) => {
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  const state: BotState = stateRaw ? JSON.parse(stateRaw) : {
    status: 'STOPPED', lastUpdated: '', activePosition: null, positionLock: false, lastMacdLine: null
  };
  const hasToken = !!(await c.env.TRADING_KV.get(KV_KEYS.UPSTOX_ACCESS_TOKEN));
  return c.json({ ...state, hasAccessToken: hasToken });
});

/** POST /api/control — Toggle bot status */
api.post('/api/control', async (c) => {
  const { action } = await c.req.json<{ action: string }>();
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  const state: BotState = stateRaw ? JSON.parse(stateRaw) : {
    status: 'STOPPED', lastUpdated: '', activePosition: null, positionLock: false, lastMacdLine: null
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

    await c.env.TRADING_KV.put(
      `${KV_KEYS.PENDING_ORDER_PREFIX}${correlationId}`,
      JSON.stringify(sellOrder),
      { expirationTtl: 300 }
    );

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

/** GET /api/chart-data — Spot + MACD for canvas chart */
api.get('/api/chart-data', async (c) => {
  const rows = await c.env.TRADING_DB.prepare(
    `SELECT timestamp, nifty_spot, macd_line FROM system_telemetry 
     WHERE date(timestamp) = ? ORDER BY timestamp`
  ).bind(getTodayDateStr()).all();

  const data = rows.results || [];
  return c.json({
    spots: data.map((r: any) => ({ timestamp: r.timestamp, value: r.nifty_spot })),
    macd: data.map((r: any) => ({ timestamp: r.timestamp, value: r.macd_line })),
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

/** GET /api/auth/callback — Handle Upstox OAuth callback */
api.get('/api/auth/callback', async (c) => {
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
