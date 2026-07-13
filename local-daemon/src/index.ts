// ============================================
// TheFinalOption — Local Execution Daemon
// Polls Cloud Worker for pending orders
// Executes trades via Upstox from whitelisted IP
// ============================================

import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logInfo, logWarn, logError, logTrade } from './logger.js';
import './server.js';
import { executeOrder, executeOrderStealth, executor } from './executor.js';
import { DataEngine } from './data-engine.js';
import { StateEngine } from './state-engine.js';
import { executeEmergencyMarketExit } from './iceberg.js';
import { ApiTracker, tracker } from './tracker.js';
import { UpstoxWSClient } from './ws-client.js';
import { brokerAdapter } from './broker-adapter.js';
import WebSocket from 'ws';
// --- Crash Guards ---
process.on('uncaughtException', (err) => {
  logError(`[FATAL] Uncaught Exception: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`[FATAL] Unhandled Promise Rejection at: ${promise}, reason: ${reason}`);
});

// --- Configuration ---
const CONFIG = {
  workerUrl: process.env.CLOUD_WORKER_URL || '',
  pollSecret: process.env.POLL_SECRET || '',
  pollInterval: parseInt(process.env.POLL_INTERVAL_MS || '1500', 10),
  dryRun: process.env.DRY_RUN === 'true',
  healthPort: parseInt(process.env.HEALTH_PORT || '3847', 10),
  upstoxToken: process.env.UPSTOX_TOKEN || '',
  // 🛡️ TASK 4.3: Default lot size for Nifty (1 lot = 75 units)
  defaultTradeQty: parseInt(process.env.DEFAULT_TRADE_QTY || '75', 10),
};

// --- Circuit Breaker ---
class CircuitBreaker {
  failures = 0;
  maxFailures = 3;
  tripped = false;

  async recordFailure() {
    this.failures++;
    if (this.failures >= this.maxFailures && !this.tripped) {
      logError('🚨 Circuit breaker tripped! 3 consecutive failures. Halting operations.');
      this.tripped = true;
      try {
        await fetch(`${CONFIG.workerUrl}/api/control`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Poll-Secret': CONFIG.pollSecret,
          },
          body: JSON.stringify({ action: 'EMERGENCY_HALT', reason: '3 consecutive Upstox API failures. Check network or Upstox portal.' }),
        });
        logInfo('Successfully sent EMERGENCY_HALT to Cloud Worker.');
      } catch (e: any) {
        logError(`Failed to send EMERGENCY_HALT: ${e.message}`);
      }
    }
  }

  recordSuccess() {
    this.failures = 0;
    this.tripped = false;
  }
}
const orderCircuitBreaker = new CircuitBreaker();

// --- State ---
let isRunning = true;
let lastPollTime = 0;
let totalOrdersExecuted = 0;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;
const MAX_BACKOFF_MS = 30000;

// --- Validation ---
function validateConfig(): boolean {
  if (!CONFIG.workerUrl) {
    logError('FATAL: CLOUD_WORKER_URL is not set');
    return false;
  }
  if (!CONFIG.pollSecret) {
    logError('FATAL: POLL_SECRET is not set');
    return false;
  }
  return true;
}

// --- Historical Data Seed ---
async function getHistoricalCandles(): Promise<any[]> {
  logInfo('Fetching initial historical data from Cloudflare...');
  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/chart-data`, {
      method: 'GET',
      headers: {
        // /api/chart-data uses dashboardAuth (HTTP Basic Auth), not X-Poll-Secret
        'Authorization': 'Basic ' + Buffer.from('vdineshprabu:Healthywealth007#').toString('base64')
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    if (data && data.spots) {
      return data.spots.map((spot: any) => ({
        timestamp: spot.timestamp,
        open: spot.open,
        high: spot.high,
        low: spot.low,
        close: spot.close,
        volume: spot.volume || 0
      }));
    }
  } catch (err: any) {
    logError(`Failed to fetch historical candles: ${err.message}`);
  }
  return [];
}

// --- Cloud WebSocket Client for Zero-Latency Sync ---
function connectCloudWS(): void {
  // Convert http/https to ws/wss
  const wsUrl = CONFIG.workerUrl.replace(/^http/, 'ws') + `/api/ws?secret=${CONFIG.pollSecret}`;
  logInfo(`🔌 Connecting to Cloud WebSocket: ${wsUrl}`);

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    logInfo('🟢 Connected to Cloud WebSocket for zero-latency execution synchronization.');
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'EXECUTION_CONFIRMATION') {
        logInfo(`⚡ Zero-Latency Execution Sync: ${message.correlationId} | Status: ${message.status} | PnL: ₹${message.pnl}`);
        tracker.setRealizedPnL(message.pnl);
      }
    } catch (e: any) {
      logError(`Failed to parse Cloud WS message: ${e.message}`);
    }
  });

  ws.on('close', () => {
    logWarn('🟡 Cloud WebSocket closed. Retrying in 5 seconds...');
    setTimeout(() => {
      if (isRunning) {
        connectCloudWS();
      }
    }, 5000);
  });

  ws.on('error', (err) => {
    logError(`❌ Cloud WebSocket error: ${err.message}`);
  });
}

// --- WS Engine ---
/**
 * 🫀 WATCHDOG HEARTBEAT (Upgraded)
 * Pings the Cloudflare API every 5 seconds.
 * Now features auto-URL cleaning and aggressive error logging.
 */
function startWatchdogHeartbeat() {
  // 1. Auto-clean the URL to prevent `//api/poll` 404 errors
  let cloudUrl = CONFIG.workerUrl || 'https://thefinaloption.thefinaloptionautomation.workers.dev';
  if (cloudUrl.endsWith('/')) {
    cloudUrl = cloudUrl.slice(0, -1); 
  }
  
  const secret = CONFIG.pollSecret || '';

  setInterval(async () => {
    try {
      const memory = process.memoryUsage();
      
      const response = await fetch(`${cloudUrl}/api/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: secret,
          memoryRss: memory.rss,
          memoryHeapUsed: memory.heapUsed,
          rateMetrics: { reqPerSecond: 1, reqPerMinute: 60 } 
        })
      });

      if (response.ok) {
        const data: any = await response.json();
        if (data.shouldRestart) {
          logWarn('[WATCHDOG] Cloud requested a daemon restart. Rebooting safely...');
          process.exit(1);
        }
      } else {
        // 🚨 THIS IS WHERE WE CATCH THE GHOST
        const errText = await response.text();
        logError(`[WATCHDOG] Heartbeat REJECTED! Status: ${response.status} | Reason: ${errText}`);
      }
    } catch (error: any) {
      logError(`[WATCHDOG] Critical Network Failure hitting Cloud API: ${error.message}`);
    }
  }, 5000); 
}

async function bootstrapEngine() {
  logInfo('═══════════════════════════════════════════');
  logInfo('  TheFinalOption — Local Execution Daemon  ');
  logInfo('═══════════════════════════════════════════');
  logInfo(`Worker URL: ${CONFIG.workerUrl}`);
  logInfo(`Dry run: ${CONFIG.dryRun}`);
  logInfo('');

  if (!validateConfig()) {
    process.exit(1);
  }

  // 1. Initialize Realtime Engine (Replaces HTTP Polling)
  let activeToken: string = '';
  await StateEngine.initialize(async (newToken) => {
    activeToken = newToken;
    brokerAdapter.initialize(newToken);
    await DataEngine.autoRecoverGaps(newToken);
  });

  // 2. Gatekeeper: Halt boot sequence until token is provided via UI
  let waitCount = 0;
  while (!StateEngine.activeToken) {
    if (waitCount === 0) logInfo('⏳ Waiting for Upstox Token. Please authenticate via the Cloudflare Dashboard...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    waitCount++;
  }

  activeToken = StateEngine.activeToken;

  // ─────────────────────────────────────────────────────────────
  // 🛡️ TASK 4.3: CRASH RECOVERY BOOT SEQUENCE
  // Reconstruct reality from the exchange before opening data feed.
  // ─────────────────────────────────────────────────────────────
  logInfo('[BOOT] Scanning exchange for active terminal state...');
  try {
    const openPositions = await brokerAdapter.getOpenPositions();

    let recoveredRealizedPnL = 0;
    let recoveredUnrealizedPnL = 0;
    let hasOpenPositions = false;

    for (const pos of openPositions) {
      recoveredRealizedPnL += pos.realizedPnL ?? 0;
      recoveredUnrealizedPnL += pos.unrealizedPnL ?? 0;
      if (pos.netQuantity !== 0) hasOpenPositions = true;
    }

    logInfo(`[BOOT] Recovery Data — Realized: ₹${recoveredRealizedPnL.toFixed(2)}, Unrealized: ₹${recoveredUnrealizedPnL.toFixed(2)}, Open Positions: ${hasOpenPositions}`);

    // Re-arm circuit breakers with recovered state
    await tracker.initializeDailyState(async () => parseFloat(process.env.STARTING_CAPITAL || '100000'), recoveredRealizedPnL);
    tracker.updateUnrealizedPnL(recoveredUnrealizedPnL);

    const bootState = tracker.getState();

    // Evaluate if we crashed mid-drawdown and need emergency exit
    if (bootState.isShieldModeActive && hasOpenPositions) {
      const projectedNetPnL = bootState.dailyRealizedPnL + bootState.activeUnrealizedPnL;
      if (projectedNetPnL <= (bootState.secureTarget ?? 0)) {
        logWarn('[BOOT] 🚨 WOKE UP IN CRITICAL DRAWDOWN. SHIELD MODE ACTIVE. DUMPING POSITIONS NOW.');
        await executeEmergencyMarketExit();
        tracker.haltTrading('Mid-Crash Drawdown on boot — positions exited to protect capital baseline.');
      }
    }

    // If already halted (e.g. 20% daily loss was hit before crash), abort the data feed
    if (tracker.getState().isHalted) {
      logWarn('[BOOT] System is HALTED from a prior session. Daemon is running in monitor-only mode. No new trades will fire.');
    }
  } catch (recoveryErr: any) {
    logError(`[BOOT] Non-fatal: Could not complete crash recovery scan: ${recoveryErr.message}. Proceeding with fresh state.`);
  }
  // ─────────────────────────────────────────────────────────────

  // Health Check Server is now initialized via server.ts import
  logInfo('Unified Management Server automatically booting...');

  // Connect to Cloud Worker WebSocket
  connectCloudWS();

  // 🚀 NEW: Start the Heartbeat so the Dashboard stops auto-killing the bot
  startWatchdogHeartbeat();

  // Background Sweeper (runs every 15 seconds)
  setInterval(() => {
    sweepOrphanedOrders(activeToken).catch(e => logError(`Sweeper crash: ${e.message}`));
  }, 15000);

  // Daemon Heartbeat (runs every 60 seconds)
  setInterval(() => {
    sendHeartbeat().catch(e => logError(`Heartbeat crash: ${e.message}`));
  }, 60000);

  // 2. Start the WebSocket
  let wsClient = new UpstoxWSClient(activeToken);

  // ProfitTracker Sync (runs every 10 seconds)
  setInterval(() => {
    syncProfitTracker(wsClient).catch(e => logError(`ProfitTracker sync crash: ${e.message}`));
  }, 10000);

  // Initial sync before starting WS
  await syncProfitTracker(wsClient);

  // 1. Fetch initial historical data via HTTP (Seed the aggregator)
  const historicalData = await getHistoricalCandles();

  // 2. Start the WebSocket
  // wsClient was initialized above
  // Typecasting access to private property to seed data cleanly in this script
  (wsClient as any).aggregator.seedHistoricalData(historicalData);
  // 3. Define the signal callback
  const onSignal = async (signalPayload: any) => {
    logInfo(`[SIGNAL] 1-Min Candle Closed. MACD: ${signalPayload.currentMacd.toFixed(2)} | Signal: ${signalPayload.signal}`);

    // 🟢 Write the closed candle to Supabase immediately
    await DataEngine.recordLiveCandle({
      timestamp: signalPayload.timestamp,
      open: signalPayload.open,
      high: signalPayload.high,
      low: signalPayload.low,
      close: signalPayload.close,
      volume: signalPayload.volume || 0
    });

    // 🛡️ THE GATEKEEPER: Stop processing if the UI says STOPPED
    if (StateEngine.botStatus !== 'RUNNING') {
      logInfo(`[GATEKEEPER] Signal generated, but bot is currently ${StateEngine.botStatus}. Ignoring trade.`);
      return; 
    }

    // ⚡ NATIVE EXECUTION ROUTING (Bypassing Cloudflare completely)
    if (signalPayload.signal.startsWith('BUY')) {
        // Calculate lot sizing based on your max risk config, or hardcode quantity for now
        const targetQuantity = CONFIG.defaultTradeQty || 50; 
        
        // Push directly into the EC2 executor
        await executor.evaluateAndExecuteTrade(
            signalPayload.signal, 
            targetQuantity, 
            signalPayload.close, // LTP
            {} as any, // Mock market depth if your WS isn't supplying L2 data
            signalPayload.delta || 50 // Institutional order flow delta
        );
    }
  };

  // 4. Connect WebSocket with retry loop — auth failures do NOT crash the process
  const connectWithRetry = async () => {
    while (true) {
      try {
        logInfo('🔌 Connecting to Upstox WebSocket...');
        await wsClient.connect(onSignal);
        break; // connected successfully — ws.on('close') handles reconnects internally
      } catch (err: any) {
        const isAuthError = err.message.includes('401') || err.message.includes('410') || err.message.includes('Auth');
        if (isAuthError) {
          logWarn(`⚠️  Upstox token rejected (${err.message.split(':')[0].trim()}). Please re-authenticate at your dashboard. Retrying in 60s...`);
          await new Promise(resolve => setTimeout(resolve, 60000));

          try {
            logInfo('🔄 Attempting to fetch fresh token from Cloudflare...');
            const res = await fetch(`${CONFIG.workerUrl}/api/poll`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret: CONFIG.pollSecret })
            });
            if (res.ok) {
              const data: any = await res.json();
              if (data && data.accessToken) {
                activeToken = data.accessToken;
                brokerAdapter.initialize(activeToken);
                
                // 🩹 Trigger a gap recovery when reconnecting after a failure
                await DataEngine.autoRecoverGaps(activeToken);
                
                // Re-instantiate the client with the fresh token
                wsClient = new UpstoxWSClient(activeToken);
                (wsClient as any).aggregator.seedHistoricalData(historicalData);
                logInfo('✅ Fresh token loaded. Retrying connection...');
              }
            }
          } catch (e: any) {
            logError(`Failed to fetch fresh token: ${e.message}`);
          }
        } else {
          logError(`WS connect error: ${err.message}. Retrying in 15s...`);
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
      }
    }
  };

  connectWithRetry().catch(e => logError(`Fatal WS loop: ${e.message}`));

  // Graceful shutdown
  process.on('SIGINT', () => {
    logInfo('🛑 Shutting down gracefully...');
    isRunning = false;
    if (wsClient) (wsClient as any).archiver?.close(); // Flush CSV buffer to disk
    setTimeout(() => process.exit(0), 1000);
  });

  process.on('SIGTERM', () => {
    logInfo('🛑 SIGTERM received, shutting down...');
    isRunning = false;
    if (wsClient) (wsClient as any).archiver?.close(); // Flush CSV buffer to disk
    setTimeout(() => process.exit(0), 1000);
  });
}

// Ensure sweepOrphanedOrders accepts activeToken
async function sweepOrphanedOrders(activeToken: string): Promise<void> {
  if (!activeToken) return;
  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/sweep-orphans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: CONFIG.pollSecret })
    });
    if (!res.ok) return;
    const data: any = await res.json();
    if (!data.hasOrphans) return;

    for (const order of data.orders) {
      logWarn(`🔍 Sweeping Phantom Order: ${order.upstox_order_id}`);
      ApiTracker.recordCall();
      const statusRes = await fetch(`https://api.upstox.com/v2/order/details?order_id=${order.upstox_order_id}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${activeToken}`,
        },
      });

      if (!statusRes.ok) continue;

      const sData: any = await statusRes.json();
      const uOrder = sData.data?.[0];
      if (!uOrder) continue;

      const upstoxStatus = uOrder.status?.toUpperCase();

      if (upstoxStatus === 'COMPLETE' || upstoxStatus === 'FILLED' || upstoxStatus === 'REJECTED' || upstoxStatus === 'CANCELLED') {
        const finalStatus = upstoxStatus === 'COMPLETE' ? 'FILLED' : upstoxStatus as any;

        await confirmOrder({
          correlationId: order.correlation_id,
          upstoxOrderId: order.upstox_order_id,
          status: finalStatus,
          executionPrice: parseFloat(uOrder.average_price || uOrder.price || '0'),
          filledQuantity: parseInt(uOrder.filled_quantity || '0', 10),
          statusMessage: uOrder.status_message || 'Recovered by Daemon Sweeper',
          timestamp: new Date().toISOString(),
        });

        logInfo(`✅ Phantom Order Resolved: ${order.upstox_order_id} -> ${finalStatus}`);
      } else {
        const orderAgeHours = (Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60);
        if (orderAgeHours > 24) {
          logError(`🚨 Phantom Order ${order.upstox_order_id} timed out. Escalating to DLQ.`);
          try {
            await fetch(`${CONFIG.workerUrl}/api/dlq`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ correlationId: order.correlation_id, upstoxOrderId: order.upstox_order_id }),
            });
          } catch (e) { }
        }
      }
    }
  } catch (e: any) {
    logError(`Sweeper Error: ${e.message}`);
  }
}

// --- Confirm Order ---
async function confirmOrder(result: any): Promise<void> {
  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: CONFIG.pollSecret, result }),
    });
    if (res.ok) {
      logInfo(`✅ Confirmation sent for ${result.correlationId}`);
      orderCircuitBreaker.recordSuccess();
      totalOrdersExecuted++;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e: any) {
    logError(`❌ Confirmation failed for ${result.correlationId}: ${e.message}`);
    orderCircuitBreaker.recordFailure();
  }
}

// --- Health Check Server handled by server.ts ---

// --- Daemon Heartbeat ---
async function sendHeartbeat(): Promise<void> {
  try {
    await fetch(`${CONFIG.workerUrl}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: CONFIG.pollSecret,
        uptime: process.uptime(),
        ordersExecuted: totalOrdersExecuted
      }),
    });
  } catch (e) {
  }
}

// --- ProfitTracker Sync ---
async function syncProfitTracker(wsClient?: UpstoxWSClient): Promise<void> {
  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/status`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('vdineshprabu:Healthywealth007#').toString('base64')
      }
    });
    if (res.ok) {
      const data: any = await res.json();

      // Init Capital & Realized PnL
      if (data.margin && data.margin.totalBalance) {
        await tracker.initializeDailyState(async () => data.margin.totalBalance, data.todayRealizedPnL || 0);
      } else {
        // Fallback to update realized PNL even if margin is delayed
        tracker.setRealizedPnL(data.todayRealizedPnL || 0);
      }

      // Sync Active Position
      if (data.activePosition) {
        if (tracker.activePositionToken !== data.activePosition.instrumentToken) {
          tracker.setActivePosition(
            data.activePosition.instrumentToken,
            data.activePosition.quantity,
            data.activePosition.entryPrice
          );
          if (wsClient) wsClient.subscribe(data.activePosition.instrumentToken);
        }
      } else {
        tracker.clearActivePosition();
      }
    }
  } catch (e: any) {
    logError(`❌ ProfitTracker Sync failed: ${e.message}`);
  }
}

// --- Entry ---
bootstrapEngine().catch((err: any) => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
