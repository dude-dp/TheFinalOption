// ============================================
// TheFinalOption — Local Execution Daemon
// Polls Cloud Worker for pending orders
// Executes trades via Upstox from whitelisted IP
// ============================================

import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

import { createServer } from 'node:http';
import { logInfo, logWarn, logError, logTrade } from './logger.js';
import { executeOrder, executeOrderStealth } from './executor.js';
import { ApiTracker } from './tracker.js';
import { UpstoxWSClient } from './ws-client.js';

// --- Configuration ---
const CONFIG = {
  workerUrl: process.env.CLOUD_WORKER_URL || '',
  pollSecret: process.env.POLL_SECRET || '',
  pollInterval: parseInt(process.env.POLL_INTERVAL_MS || '1500', 10),
  dryRun: process.env.DRY_RUN === 'true',
  healthPort: parseInt(process.env.HEALTH_PORT || '3847', 10),
  upstoxToken: process.env.UPSTOX_TOKEN || '',
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
          body: JSON.stringify({ action: 'EMERGENCY_HALT' }),
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
        'X-Poll-Secret': CONFIG.pollSecret
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
  } catch(err: any) {
    logError(`Failed to fetch historical candles: ${err.message}`);
  }
  return [];
}

// --- WS Engine ---
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

  // Retrieve token dynamically if not in .env
  let activeToken = CONFIG.upstoxToken;
  if (!activeToken) {
    logInfo('No UPSTOX_TOKEN in .env. Bootstrapping token from Cloudflare...');
    try {
      const res = await fetch(`${CONFIG.workerUrl}/api/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: CONFIG.pollSecret })
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      
      const data: any = await res.json();
      if (data && data.accessToken) {
        activeToken = data.accessToken;
      } else {
        throw new Error('No accessToken returned from Cloudflare');
      }
    } catch(err: any) {
      logError(`Failed to bootstrap access token: ${err.message}`);
      process.exit(1);
    }
  }

  // Start health check server
  startHealthServer();

  // Background Sweeper (runs every 15 seconds)
  setInterval(() => {
    sweepOrphanedOrders(activeToken).catch(e => logError(`Sweeper crash: ${e.message}`));
  }, 15000);

  // Daemon Heartbeat (runs every 60 seconds)
  setInterval(() => {
    sendHeartbeat().catch(e => logError(`Heartbeat crash: ${e.message}`));
  }, 60000);

  // 1. Fetch initial historical data via HTTP (Seed the aggregator)
  const historicalData = await getHistoricalCandles();

  // 2. Start the WebSocket
  const wsClient = new UpstoxWSClient(activeToken);
  // Typecasting access to private property to seed data cleanly in this script
  (wsClient as any).aggregator.seedHistoricalData(historicalData);

  // 3. Define the Cloudflare transmission callback
  wsClient.connect(async (signalPayload) => {
    logInfo(`[SIGNAL] 1-Min Candle Closed. MACD: ${signalPayload.currentMacd.toFixed(2)} | Signal: ${signalPayload.signal}`);
    
    try {
      const response = await fetch(`${CONFIG.workerUrl}/api/signal-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: CONFIG.pollSecret,
          ...signalPayload
        })
      });
      
      const commands: any = await response.json();
      
      if (commands.orders && commands.orders.length > 0) {
        const sells = commands.orders.filter((o: any) => o.transactionType === 'SELL');
        const buys = commands.orders.filter((o: any) => o.transactionType === 'BUY');
        const ordered = [...sells, ...buys];

        for (const order of ordered) {
          if (orderCircuitBreaker.tripped) {
            logWarn('Circuit breaker is tripped. Skipping execution.');
            continue;
          }

          logTrade(`📥 Received execution order via WS Signal: ${order.correlationId}`);

          let resultPayload: any;
          
          if (CONFIG.dryRun) {
            resultPayload = await executeOrder(order, activeToken, true);
          } else {
            const executionResult = await executeOrderStealth(order, activeToken);

            let finalStatus = executionResult.success ? 'FILLED' : (executionResult.filledLots > 0 ? 'PARTIALLY_FILLED' : 'REJECTED');
            
            if (executionResult.success) {
              logInfo(`[SUCCESS] 🟢 Iceberg fully deployed! ${executionResult.filledLots}/${executionResult.requestedLots} lots filled.`);
            } else {
              logWarn(`[WARN] 🟡 Iceberg partially/fully failed. ${executionResult.filledLots}/${executionResult.requestedLots} lots filled.`);
            }

            resultPayload = {
              correlationId: order.correlationId,
              upstoxOrderId: executionResult.details[0]?.orderId || `ICEBERG-${Date.now()}`,
              status: finalStatus,
              executionPrice: order.orderPrice,
              filledQuantity: executionResult.filledLots,
              statusMessage: executionResult.success ? 'Stealth Iceberg Execution Complete' : 'Iceberg partially failed',
              timestamp: new Date().toISOString(),
            };
          }
          await confirmOrder(resultPayload);
        }
      }
    } catch (err: any) {
      logError(`[ERROR] Failed to push signal to Cloudflare: ${err.message}`);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    logInfo('🛑 Shutting down gracefully...');
    isRunning = false;
    setTimeout(() => process.exit(0), 1000);
  });

  process.on('SIGTERM', () => {
    logInfo('🛑 SIGTERM received, shutting down...');
    isRunning = false;
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
          } catch (e) {}
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

// --- Health Check Server ---
function startHealthServer(): void {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        uptime: process.uptime(),
        ordersExecuted: totalOrdersExecuted,
        circuitBreakerTripped: orderCircuitBreaker.tripped
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(CONFIG.healthPort, '0.0.0.0', () => {
    logInfo(`🏥 Health check server listening on port ${CONFIG.healthPort}`);
  });
}

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

// --- Entry ---
bootstrapEngine().catch((err: any) => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
