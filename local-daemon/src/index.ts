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

// --- Configuration ---
const CONFIG = {
  workerUrl: process.env.CLOUD_WORKER_URL || '',
  pollSecret: process.env.POLL_SECRET || '',
  pollInterval: parseInt(process.env.POLL_INTERVAL_MS || '1500', 10),
  dryRun: process.env.DRY_RUN === 'true',
  healthPort: parseInt(process.env.HEALTH_PORT || '3847', 10),
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

// --- Poll Worker ---
async function pollWorker(): Promise<void> {
  try {
    const memory = process.memoryUsage();
    const rateMetrics = ApiTracker.getMetrics();
    const res = await fetch(`${CONFIG.workerUrl}/api/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: CONFIG.pollSecret,
        memoryRss: memory.rss,
        memoryHeapUsed: memory.heapUsed,
        rateMetrics,
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!res.ok) {
      throw new Error(`Poll failed: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    consecutiveErrors = 0; // Reset on success
    lastPollTime = Date.now();

    // Handle Watchdog Restart Command
    if (data.shouldRestart) {
      logWarn(`🔴 Memory threshold breached. Cloudflare requested a safe restart.`);
      logWarn(`Current RSS Memory: ${(memory.rss / 1024 / 1024).toFixed(2)} MB. Exiting gracefully...`);
      
      setTimeout(() => {
        process.exit(0);
      }, 1000);

      isRunning = false;
      return;
    }

    // Check bot status
    if (data.botStatus === 'STOPPED') {
      return; // Silent — bot is intentionally stopped
    }

    if (data.botStatus === 'EMERGENCY_HALT') {
      logWarn('⚠️ Bot is in EMERGENCY HALT mode');
    }

    // Process any pending orders
    if (data.hasOrders && data.orders?.length > 0) {
      const accessToken = data.accessToken;

      if (!accessToken) {
        logError('Cannot execute: No access token from Worker');
        return;
      }

      // Process SELL orders before BUY orders (for position reversal)
      const sells = data.orders.filter((o: any) => o.transactionType === 'SELL');
      const buys = data.orders.filter((o: any) => o.transactionType === 'BUY');
      const ordered = [...sells, ...buys];

      for (const order of ordered) {
        if (orderCircuitBreaker.tripped) {
          logWarn('Circuit breaker is tripped. Skipping execution.');
          continue;
        }

        logTrade(`📥 Received order: ${order.correlationId}`);

        let resultPayload: any;
        
        if (CONFIG.dryRun) {
          resultPayload = await executeOrder(order, accessToken, true);
        } else {
          const executionResult = await executeOrderStealth(order, accessToken);

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
            filledQuantity: executionResult.filledLots * (order.quantity / order.lots),
            rejectionReason: executionResult.success ? null : 'Iceberg partially/fully failed'
          };
        }

        if (resultPayload.status === 'REJECTED' && resultPayload.rejectionReason?.match(/HTTP 5\d\d/)) {
          await orderCircuitBreaker.recordFailure();
        } else {
          orderCircuitBreaker.recordSuccess();
        }

        // Send confirmation back to Cloud Worker
        await confirmOrder(resultPayload);
        totalOrdersExecuted++;
      }
    }

  } catch (error: any) {
    consecutiveErrors++;

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      logWarn(`Poll timeout (attempt ${consecutiveErrors})`);
    } else {
      logError(`Poll error (attempt ${consecutiveErrors}): ${error.message}`);
    }

    // Circuit breaker
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      logError(`🔴 ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Backing off heavily.`);
    }
  }
}

// --- Background Orphan Sweeper ---
let isCheckingOrphans = false;

async function sweepOrphanedOrders(): Promise<void> {
  if (isCheckingOrphans) return; // Prevent overlapping sweeps
  isCheckingOrphans = true;

  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/unresolved-orders`, {
      method: 'GET',
      headers: { 'X-Poll-Secret': CONFIG.pollSecret },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return;

    const data: any = await res.json();
    if (!data.hasOrphans || !data.accessToken) return;

    for (const order of data.orders) {
      logWarn(`🔍 Sweeping Phantom Order: ${order.upstox_order_id}`);

      // Query Upstox directly for the true status of this order
      ApiTracker.recordCall();
      const statusRes = await fetch(`https://api.upstox.com/v2/order/details?order_id=${order.upstox_order_id}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${data.accessToken}`,
        },
      });

      if (!statusRes.ok) continue;

      const statusData: any = await statusRes.json();
      const uOrder = statusData?.data;
      if (!uOrder) continue;

      const upstoxStatus = uOrder.status?.toUpperCase();

      // If the order has finally reached a terminal state on the exchange...
      if (upstoxStatus === 'COMPLETE' || upstoxStatus === 'FILLED' || upstoxStatus === 'REJECTED' || upstoxStatus === 'CANCELLED') {

        const finalStatus = upstoxStatus === 'COMPLETE' ? 'FILLED' : upstoxStatus as any;

        const result = {
          correlationId: order.correlation_id,
          upstoxOrderId: order.upstox_order_id,
          status: finalStatus,
          executionPrice: uOrder.average_price || uOrder.traded_price || null,
          filledQuantity: uOrder.filled_quantity || uOrder.quantity || null,
          rejectionReason: uOrder.status_message || null,
        };

        // Push the final confirmation back to Cloudflare
        await confirmOrder(result);
        logInfo(`✅ Phantom Order Resolved: ${order.upstox_order_id} -> ${finalStatus}`);
      } else {
        // Still not terminal, check TTL
        const orderAgeMs = Date.now() - new Date(order.created_at + 'Z').getTime(); // assuming created_at is UTC
        if (orderAgeMs > 5 * 60 * 1000) {
          logError(`🚨 Phantom Order ${order.upstox_order_id} timed out. Escalating to DLQ.`);
          await fetch(`${CONFIG.workerUrl}/api/escalate-order`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Poll-Secret': CONFIG.pollSecret,
            },
            body: JSON.stringify({ correlationId: order.correlation_id, upstoxOrderId: order.upstox_order_id }),
          });
        }
      }
    }
  } catch (error: any) {
    if (error.name !== 'TimeoutError' && error.name !== 'AbortError') {
      logError(`Orphan Sweeper error: ${error.message}`);
    }
  } finally {
    isCheckingOrphans = false;
  }
}

// --- Confirm Order ---
async function confirmOrder(result: any): Promise<void> {
  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Poll-Secret': CONFIG.pollSecret,
      },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      logError(`Confirm failed: HTTP ${res.status}`);
    } else {
      logInfo(`✅ Confirmed ${result.correlationId} → ${result.status}`);
    }
  } catch (error: any) {
    logError(`Confirm error: ${error.message}`);
  }
}

// --- Health Check Server ---
function startHealthServer(): void {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: isRunning ? 'healthy' : 'stopped',
        uptime: process.uptime(),
        lastPoll: lastPollTime ? new Date(lastPollTime).toISOString() : null,
        totalOrders: totalOrdersExecuted,
        consecutiveErrors,
        dryRun: CONFIG.dryRun,
        circuitBreakerTripped: orderCircuitBreaker.tripped,
      }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(CONFIG.healthPort, () => {
    logInfo(`Health check: http://localhost:${CONFIG.healthPort}/health`);
  });
}

// --- Daemon Heartbeat ---
async function sendHeartbeat(): Promise<void> {
  try {
    const memory = process.memoryUsage();
    await fetch(`${CONFIG.workerUrl}/api/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Poll-Secret': CONFIG.pollSecret,
      },
      body: JSON.stringify({
        memoryUsage: memory.rss,
        uptime: process.uptime(),
        consecutiveErrors,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error: any) {
    if (error.name !== 'TimeoutError' && error.name !== 'AbortError') {
      logWarn(`Heartbeat error: ${error.message}`);
    }
  }
}

// --- Main Loop ---
async function main(): Promise<void> {
  logInfo('═══════════════════════════════════════════');
  logInfo('  TheFinalOption — Local Execution Daemon  ');
  logInfo('═══════════════════════════════════════════');
  logInfo(`Worker URL: ${CONFIG.workerUrl}`);
  logInfo(`Poll interval: ${CONFIG.pollInterval}ms`);
  logInfo(`Dry run: ${CONFIG.dryRun}`);
  logInfo('');

  if (!validateConfig()) {
    process.exit(1);
  }

  // Start health check server
  startHealthServer();

  // Background Sweeper (runs every 15 seconds)
  setInterval(() => {
    sweepOrphanedOrders().catch(e => logError(`Sweeper crash: ${e.message}`));
  }, 15000);

  // Daemon Heartbeat (runs every 60 seconds)
  setInterval(() => {
    sendHeartbeat().catch(e => logError(`Heartbeat crash: ${e.message}`));
  }, 60000);

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

  // Polling loop
  while (isRunning) {
    await pollWorker();

    // Calculate sleep time with exponential backoff on errors
    let sleepMs = CONFIG.pollInterval;
    if (consecutiveErrors > 0) {
      sleepMs = Math.min(
        CONFIG.pollInterval * Math.pow(2, consecutiveErrors),
        MAX_BACKOFF_MS
      );
    }

    await new Promise(resolve => setTimeout(resolve, sleepMs));
  }

  logInfo('Daemon stopped.');
}

// --- Entry ---
main().catch((err) => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
