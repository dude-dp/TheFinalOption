// ============================================
// TheFinalOption — Native EC2 Execution Daemon
// ============================================

import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

import { logInfo, logWarn, logError } from './logger.js';
import './server.js';
import { executor } from './executor.js';
import { DataEngine } from './data-engine.js';
import { StateEngine } from './state-engine.js';
import { executeEmergencyMarketExit } from './executor.js';
import { tracker } from './tracker.js';
import { UpstoxWSClient } from './ws-client.js';
import { brokerAdapter } from './broker-adapter.js';

import { createClient } from '@supabase/supabase-js';

export let activeWsClient: UpstoxWSClient | null = null;

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

process.on('uncaughtException', (err) => logError(`[FATAL] Uncaught Exception: ${err.message}\n${err.stack}`));
process.on('unhandledRejection', (reason, promise) => logError(`[FATAL] Unhandled Rejection at: ${promise}, reason: ${reason}`));

const CONFIG = {
  defaultTradeQty: parseInt(process.env.DEFAULT_TRADE_QTY || '75', 10),
};

async function getHistoricalCandles(): Promise<any[]> {
  try {
    logInfo(`[BOOT] Fetching historical candles from Supabase: ${process.env.SUPABASE_URL}`);
    const { data, error } = await supabase
      .from('nifty_candles')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) {
      logError(`[BOOT] Supabase query failed: ${error.message}`);
      throw error;
    }

    logInfo(`[BOOT] Fetched ${data?.length ?? 0} historical candles from Supabase.`);
    if (!data) return [];

    // The aggregator expects them chronologically (oldest to newest)
    return data.reverse().map((row: any) => ({
      timestamp: row.timestamp,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || 0),
      buyVolume: 0,
      sellVolume: 0,
      delta: 0
    }));
  } catch (err: any) {
    logError(`[BOOT] Failed to seed historical candles from Supabase: ${err.message}`);
    return [];
  }
}

async function bootstrapEngine() {
  logInfo('═══════════════════════════════════════════');
  logInfo('  TheFinalOption — Local Execution Daemon  ');
  logInfo('═══════════════════════════════════════════');

  // 1. Initialize Realtime Engine 
  let activeToken: string = '';
  await StateEngine.initialize(async (newToken) => {
    activeToken = newToken;
    brokerAdapter.initialize(newToken);
    if (activeWsClient) {
      activeWsClient.updateToken(newToken);
    }
    await DataEngine.autoRecoverGaps(newToken);
  });

  // 2. Wait for UI Authentication
  let waitCount = 0;
  while (!StateEngine.activeToken) {
    if (waitCount === 0) logInfo('⏳ Waiting for Upstox Token via Dashboard...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    waitCount++;
  }
  activeToken = StateEngine.activeToken;

  // 3. Crash Recovery Boot Sequence
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

    logInfo(`[BOOT] Recovery Data — Realized: ₹${recoveredRealizedPnL.toFixed(2)}, Unrealized: ₹${recoveredUnrealizedPnL.toFixed(2)}`);

    // 🟢 FIXED: Use actual Upstox margin to set Circuit Breakers
    await tracker.initializeDailyState(async () => {
      const marginData = await brokerAdapter.getFundsAndMargin(true);
      return marginData.available_margin || 100000;
    }, recoveredRealizedPnL);

    tracker.updateUnrealizedPnL(recoveredUnrealizedPnL);

    const bootState = tracker.getState();
    if (bootState.isShieldModeActive && hasOpenPositions) {
      const projectedNetPnL = bootState.dailyRealizedPnL + bootState.activeUnrealizedPnL;
      if (projectedNetPnL <= (bootState.secureTarget ?? 0)) {
        logWarn('[BOOT] 🚨 WOKE UP IN CRITICAL DRAWDOWN. DUMPING POSITIONS NOW.');
        await executeEmergencyMarketExit();
        tracker.haltTrading('Mid-Crash Drawdown on boot — positions exited to protect capital baseline.');
      }
    }

    if (tracker.getState().isHalted) {
      logWarn('[BOOT] System is HALTED from a prior session. Monitor-only mode active.');
    }
  } catch (recoveryErr: any) {
    logError(`[BOOT] Recovery scan failed: ${recoveryErr.message}. Proceeding with fresh state.`);
  }

  // 4. Start WebSocket Engine
  activeWsClient = new UpstoxWSClient(activeToken);
  let wsClient = activeWsClient;
  const historicalData = await getHistoricalCandles();
  (wsClient as any).aggregator.seedHistoricalData(historicalData);

  const onSignal = async (signalPayload: any) => {
    logInfo(`[SIGNAL] Candle Closed. MACD: ${signalPayload.currentMacd.toFixed(2)} | Signal: ${signalPayload.signal}`);

    // 🗑️ DELETED the duplicate DataEngine.recordLiveCandle here.
    // ws-client.ts natively handles pushing the candle to Supabase!

    // Gatekeeper: Block trades if UI is stopped
    if (StateEngine.botStatus !== 'RUNNING') return;

    if (signalPayload.signal.startsWith('BUY')) {
      await executor.evaluateAndExecuteTrade(
        signalPayload.signal,
        CONFIG.defaultTradeQty,
        signalPayload.spotPrice, // 🟢 FIXED: Changed from .close to .spotPrice
        signalPayload.depth,
        signalPayload.crossoverDelta || 50
      );
    }
  };

  const connectWithRetry = async () => {
  while (true) {
    try {
      logInfo('🔌 Connecting to Upstox WebSocket...');
      await wsClient.connect(onSignal);
      break;
    } catch (err: any) {
      if (err.message.includes('401') || err.message.includes('Auth')) {
        logWarn(`⚠️ Token rejected. Re-authenticate on dashboard. Retrying in 30s...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        logError(`WS error: ${err.message}. Retrying in 15s...`);
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }
  }
};

connectWithRetry().catch(e => logError(`Fatal WS loop: ${e.message}`));

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
}

bootstrapEngine().catch((err: any) => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
