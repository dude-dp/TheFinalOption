// ============================================
// Hono API Routes — The Bridge
// Secure endpoints for daemon polling, dashboard
// ============================================

import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
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

async function getUpstoxAccessToken(c: any): Promise<string | null> {
  try {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('system_state')
      .select('upstox_access_token')
      .eq('id', 1)
      .single();
    if (error || !data) return null;
    return data.upstox_access_token;
  } catch (err) {
    console.error('[DB ERR] Failed to fetch upstox access token from Supabase:', err);
    return null;
  }
}

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
  try {
    const body = await c.req.json<{ 
      secret: string; 
      memoryRss?: number; 
      memoryHeapUsed?: number;
      rateMetrics?: { reqPerSecond: number; reqPerMinute: number };
    }>();
    
    if (body.secret !== c.env.POLL_SECRET) return c.json({ error: 'Unauthorized' }, 401);

    const kv = c.env.TRADING_KV;
    // Initialize Supabase client
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

    const stateRaw = await kv.get(KV_KEYS.BOT_STATE);
    if (!stateRaw) return c.json({ error: 'Bot state not found' }, 404);
    const state: BotState = JSON.parse(stateRaw);

    // 1. Update KV Heartbeat Metrics (Race Condition Safe & KV Rate-Limit Proof)
    if (body.rateMetrics) {
      const latestStateRaw = await kv.get(KV_KEYS.BOT_STATE);
      const latestState: BotState = latestStateRaw ? JSON.parse(latestStateRaw) : state;
      
      const lastUpdated = latestState.daemonMetrics?.lastUpdated || 0;
      const now = Date.now();

      // 🛡️ THE KV THROTTLE: Only execute the KV write once every 2 minutes (120,000 ms).
      // Allows 5-second polling for ultra-fast command execution without hitting the 1,000/day KV limit.
      if (now - lastUpdated > 120000) {
        latestState.daemonMetrics = {
          reqPerSecond: body.rateMetrics.reqPerSecond,
          reqPerMinute: body.rateMetrics.reqPerMinute,
          lastUpdated: now
        };
        try {
          await kv.put(KV_KEYS.BOT_STATE, JSON.stringify(latestState));
          await kv.put('daemon_last_heartbeat', now.toString());
        } catch (kvErr: any) {
          console.error('[KV WARN] Rate limit hit on put:', kvErr.message);
        }
      }
    }

    // 2. Watchdog Memory Check (Writes to Supabase)
    let triggerWatchdogRestart = false;
    const MEMORY_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB limit

    if (body.memoryRss && body.memoryRss > MEMORY_LIMIT_BYTES) {
      const hasNoActivePositions = !state.activePosition && !state.activeHedgePosition;
      if (hasNoActivePositions) {
        triggerWatchdogRestart = true;
        const currentMemoryMB = (body.memoryRss / 1024 / 1024).toFixed(1);
        
        // Supabase Insert instead of D1
        await supabase.from('system_telemetry').insert({
          nifty_spot: 0,
          atm_strike: 0,
          macd_line: 0,
          prev_macd_line: 0,
          signal_generated: 'NONE',
          bot_status: state.status || 'STOPPED',
          log_message: `WATCHDOG: Triggering daemon restart. RSS: ${currentMemoryMB}MB exceeds threshold.`
        });
      }
    }

    // 3. Pending Order Processing (Updates Supabase)
    const orders: OrderPayload[] = [];
    let accessToken = null;
    
    if (!triggerWatchdogRestart) {
      const rawPending = await kv.get(KV_KEYS.PENDING_ORDERS);
      const pendingList: OrderPayload[] = rawPending ? JSON.parse(rawPending) : [];
      const remainingList: OrderPayload[] = [];
      let changed = false;

      for (const order of pendingList) {
        if (order.status === 'PENDING') {
          orders.push(order);
          order.status = 'DISPATCHED';
          changed = true;
          
          // Supabase Update instead of D1
          await supabase
            .from('order_ledger')
            .update({ 
              order_status: 'DISPATCHED', 
              updated_at: new Date().toISOString() 
            })
            .eq('correlation_id', order.correlationId);
        }
        remainingList.push(order);
      }

      if (changed) {
        try {
          await kv.put(KV_KEYS.PENDING_ORDERS, JSON.stringify(remainingList));
        } catch (kvErr: any) {
          console.error('[KV WARN] Rate limit hit on PENDING_ORDERS put:', kvErr.message);
        }
      }
      accessToken = await getUpstoxAccessToken(c);
    }

    return c.json({
      success: true,
      shouldRestart: triggerWatchdogRestart,
      hasOrders: orders.length > 0,
      orders,
      accessToken,
      botStatus: state.status || 'STOPPED',
    });
  } catch (err: any) {
    return c.json({ error: 'Crash in /api/poll', details: err.message, stack: err.stack }, 500);
  }
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

  const accessToken = await getUpstoxAccessToken(c);

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

  try {
    await c.env.TRADING_KV.put('daemon_last_heartbeat', Date.now().toString());
  } catch (kvErr: any) {
    console.error('[KV WARN] Rate limit hit on daemon_last_heartbeat put:', kvErr.message);
  }
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

/** GET /api/status — Fully consolidated Supabase state query */
api.get('/api/status', async (c) => {
  try {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY as string);
    const { data: sysState, error } = await supabase
      .from('system_state')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !sysState) {
      return c.json({ error: error?.message || 'State record unallocated.' }, 500);
    }

    const now = Date.now();
    const heartbeatTime = new Date(sysState.daemon_last_heartbeat || now).getTime();
    const daemonAlive = (now - heartbeatTime) < 15000; 

    return c.json({
      status: sysState.bot_status || 'STOPPED',
      tradingMode: sysState.trading_mode || 'LIVE',
      lastUpdated: sysState.updated_at,
      hasAccessToken: !!sysState.upstox_access_token,
      daemonAlive: daemonAlive,
      livePnL: Number(sysState.live_pnl || 0),
      ltp: Number(sysState.active_position_ltp || 0),
      margin: {
        availableMargin: sysState.account_margin?.available_margin || 0,
        usedMargin: sysState.account_margin?.used_margin || 0,
        payin: sysState.account_margin?.payin || 0
      },
      // 🛡️ MOCKS: Prevents the dashboard.js Fuel Gauge from crashing
      // 🛡️ FIXED: Renamed to 'daemonMetrics' to match exactly what dashboard.js expects
      daemonMetrics: { reqPerMinute: 0, errorRate: 0, avgLatency: 0 },
      // 🟢 UI now reads from EC2 natively
      activePosition: sysState.active_position || null,
      activeHedgePosition: null,
      lockTimestamp: null
    });
  } catch (err: any) {
    return c.json({ error: `Failed to compile UI telemetry: ${err.message}` }, 500);
  }
});

/** POST /api/control — Toggle bot status */
api.post('/api/control', async (c) => {
  const { action, mode, reason } = await c.req.json<{ action: string, mode?: 'LIVE' | 'PAPER', reason?: string }>();
  
  // FIXED: Using c.env.SUPABASE_SERVICE_KEY to match your wrangler.jsonc
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY as string);

  const dbUpdate: any = { updated_at: new Date().toISOString() };
  let newStatus = '';

  if (action === 'START') {
    newStatus = 'RUNNING';
    dbUpdate.bot_status = 'RUNNING';
  } else if (action === 'STOP') {
    newStatus = 'STOPPED';
    dbUpdate.bot_status = 'STOPPED';
  } else if (action === 'EMERGENCY_HALT') {
    newStatus = 'EMERGENCY_HALT';
    dbUpdate.bot_status = 'EMERGENCY_HALT';
  } else if (action === 'SET_MODE' && mode) {
    dbUpdate.trading_mode = mode;
  } else {
    return c.json({ error: 'Invalid action' }, 400);
  }

  const { error } = await supabase.from('system_state').update(dbUpdate).eq('id', 1);
  
  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true, status: newStatus });
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


/** POST /api/manual-entry — Queue manual commands to EC2 via Supabase */
api.post('/api/manual-entry', dashboardAuth, async (c) => {
  try {
    const body = await c.req.json();
    
    // UI sends { type: "CE" }. We must strictly map this to satisfy the Supabase NOT NULL constraint.
    const direction = body.type || body.direction || 'CE';
    const action = body.action || 'MANUAL_BUY'; 
    
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY as string);

    const { data, error } = await supabase.from('pending_commands').insert([{
      action: action,             
      direction: direction,       
      status: 'PENDING'
    }]).select('id').single();

    if (error) {
      return c.json({ error: `Command queue failed: ${error.message}` }, 500);
    }

    return c.json({ 
      success: true, 
      message: `Command queued successfully.`,
      commandId: data.id 
    });
  } catch (err: any) {
    return c.json({ error: `Worker crash: ${err.message}` }, 500);
  }
});

/** POST /api/emergency-squareoff */
api.post('/api/emergency-squareoff', async (c) => {
  const stateRaw = await c.env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  if (!stateRaw) return c.json({ error: 'No bot state' }, 404);

  const state: BotState = JSON.parse(stateRaw);
  
  // HALT THE EC2 DAEMON INSTANTLY VIA SUPABASE
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY as string);
  await supabase.from('system_state').update({ bot_status: 'EMERGENCY_HALT' }).eq('id', 1);
  
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
        const accessToken = await getUpstoxAccessToken(c);
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

let cachedChartData: any = null;
let lastChartDataFetch = 0;

/** GET /api/chart-data — NIFTY OHLC Candles + MACD */
api.get('/api/chart-data', dashboardAuth, async (c) => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
  
  // Fetch only the last 300 candles to keep the payload lightning fast
  const { data: candles, error: candleError } = await supabase
    .from('nifty_candles')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(300);

  if (candleError) {
    return c.json({ error: candleError.message }, 500);
  }

  // Supabase returns descending to get the newest, but the chart needs them ascending
  const spots = candles ? candles.reverse().map(row => {
    const rawTime = row.timestamp || row.timestamp_instrument || '';
    const validIsoDate = rawTime.includes('_') ? rawTime.split('_')[0] : rawTime;
    return {
      time: Math.floor(new Date(validIsoDate).getTime() / 1000),
      timestamp: validIsoDate,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      value: Number(row.volume)
    };
  }) : [];

  // Fetch MACD telemetry for the dashboard signals
  const { data: macdData, error: macdError } = await supabase
    .from('system_telemetry')
    .select('timestamp, macd_line')
    .order('timestamp', { ascending: false })
    .limit(300);

  const macdResults = macdData ? macdData.reverse() : [];

  return c.json({
    spots: spots,
    macd: macdResults.map((r: any) => ({ timestamp: r.timestamp, value: r.macd_line })),
  });
});

/** * POST /api/admin/backfill 
 * WAF-Bypass: Uses the Intraday endpoint instead of historical date ranges.
 */
api.post('/api/admin/backfill', dashboardAuth, async (c) => {
  const accessToken = await getUpstoxAccessToken(c);
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

    // 2. Push token directly to Supabase so EC2 can intercept it instantly
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    await supabase.from('system_state').update({
      upstox_access_token: accessToken,
      updated_at: new Date().toISOString()
    }).eq('id', 1);

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
    return c.json({ error: 'Need at least 10 trades to generate a reliable statistical baseline' }, 200);
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
