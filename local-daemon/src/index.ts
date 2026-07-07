// ============================================
// TheFinalOption — Local Execution Daemon
// Polls Cloud Worker for pending orders
// Executes trades via Upstox from whitelisted IP
// ============================================

import 'dotenv/config';
import { createServer } from 'node:http';
import { logInfo, logWarn, logError, logTrade } from './logger.js';
import { executeOrder } from './executor.js';

// --- Configuration ---
const CONFIG = {
  workerUrl: process.env.CLOUD_WORKER_URL || '',
  pollSecret: process.env.POLL_SECRET || '',
  pollInterval: parseInt(process.env.POLL_INTERVAL_MS || '1500', 10),
  dryRun: process.env.DRY_RUN === 'true',
  healthPort: parseInt(process.env.HEALTH_PORT || '3847', 10),
};

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
    const res = await fetch(`${CONFIG.workerUrl}/api/poll`, {
      method: 'GET',
      headers: {
        'X-Poll-Secret': CONFIG.pollSecret,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!res.ok) {
      throw new Error(`Poll failed: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    consecutiveErrors = 0; // Reset on success
    lastPollTime = Date.now();

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
        logTrade(`📥 Received order: ${order.correlationId}`);

        const result = await executeOrder(order, accessToken, CONFIG.dryRun);

        // Send confirmation back to Cloud Worker
        await confirmOrder(result);
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
