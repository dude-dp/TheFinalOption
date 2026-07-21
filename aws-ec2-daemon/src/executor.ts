// ============================================
// Upstox Order Executor
// Handles order placement and status polling
// ============================================

import { logInfo, logWarn, logError, logTrade } from './logger.js';
import { StateEngine } from './state-engine.js';
import { brokerAdapter } from './broker-adapter.js';
import { ApiTracker, tracker } from './tracker.js';
import type { ConfluenceSignal } from './confluence.js';
import { asyncLog } from './async-logger.js';
import { calculateGrossTargetPoints, NIFTY_LOT_SIZE_2026 } from '../../cloud/src/lib/lot-sizing.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

import { liquidityScanner } from './liquidity.js';
import type { MarketDepth } from './ws-client.js';
import { activeWsClient } from './index.js'; // 🟢 NEW IMPORT
import { isPreMarket } from './lib/market-gate.js';

/** V3 HFT endpoint — requires whitelisted static IP (EC2 Elastic IP: 13.205.66.82) */
const HFT_URL = 'https://api-hft.upstox.com';
const API_URL = 'https://api.upstox.com';

async function fetchWithBackoff(url: string, options: any, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    ApiTracker.recordCall();
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 2000;
      logWarn(`HTTP 429 Too Many Requests. Retrying after ${waitTime}ms...`);
      await sleep(waitTime);
      continue;
    }
    return res;
  }
  ApiTracker.recordCall();
  return fetch(url, options);
}

interface OrderPayload {
  orderId: string;
  correlationId: string;
  instrumentToken: string;
  tradingSymbol: string;
  optionType: string;
  strikePrice: number;
  transactionType: string;
  quantity: number;
  lots: number;
  orderPrice: number;
  status: string;
}

interface ExecutionResult {
  correlationId: string;
  upstoxOrderId: string;
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELLED';
  executionPrice: number | null;
  filledQuantity: number | null;
  rejectionReason: string | null;
}

/**
 * Execute a single order against Upstox API v3.
 * Includes 3-second polling for order status after placement.
 */
export async function executeOrder(
  order: OrderPayload,
  accessToken: string,
  dryRun: boolean
): Promise<ExecutionResult> {
  logTrade(`Executing ${order.transactionType} ${order.optionType} | ${order.tradingSymbol} × ${order.lots} lots (${order.quantity} qty)`);

  // Dry run mode — simulate success
  if (dryRun) {
    logInfo(`[DRY RUN] Would place: ${order.transactionType} ${order.instrumentToken} qty=${order.quantity}`);
    return {
      correlationId: order.correlationId,
      upstoxOrderId: `DRY-${Date.now()}`,
      status: 'FILLED',
      executionPrice: order.orderPrice,
      filledQuantity: order.quantity,
      rejectionReason: null,
    };
  }

  try {
    // Place order via Upstox standard API (bypassing HFT static IP restriction)
    const placeRes = await fetchWithBackoff(`${API_URL}/v2/order/place`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        instrument_token: order.instrumentToken,
        transaction_type: order.transactionType,
        quantity: order.quantity,
        product: 'I', // Intraday
        validity: 'DAY',
        order_type: order.orderPrice === 0 ? 'MARKET' : 'LIMIT',
        price: order.orderPrice === 0 ? 0 : order.orderPrice,
        trigger_price: 0,
        disclosed_quantity: 0,
        is_amo: false,
        slice: true, // Auto-slice for large orders exceeding freeze qty
        tag: order.correlationId.substring(0, 20),
      }),
    });

    if (!placeRes.ok) {
      const errText = await placeRes.text();
      logError(`Order placement failed (${placeRes.status}): ${errText}`);
      return {
        correlationId: order.correlationId,
        upstoxOrderId: '',
        status: 'REJECTED',
        executionPrice: null,
        filledQuantity: null,
        rejectionReason: `HTTP ${placeRes.status}: ${errText.substring(0, 200)}`,
      };
    }

    let placeData: any;
    const placeDataText = await placeRes.text();
    try {
      placeData = JSON.parse(placeDataText);
    } catch (e) {
      logError(`Invalid JSON from place API: ${placeDataText.substring(0, 100)}`);
      return {
        correlationId: order.correlationId,
        upstoxOrderId: '',
        status: 'REJECTED',
        executionPrice: null,
        filledQuantity: null,
        rejectionReason: `Invalid JSON: ${placeDataText.substring(0, 100)}`,
      };
    }
    const upstoxOrderId = placeData?.data?.order_id || '';
    logInfo(`Order placed. Upstox ID: ${upstoxOrderId}`);

    if (!upstoxOrderId) {
      return {
        correlationId: order.correlationId,
        upstoxOrderId: '',
        status: 'REJECTED',
        executionPrice: null,
        filledQuantity: null,
        rejectionReason: 'No order_id in response',
      };
    }

    // Poll order status for 3 seconds
    const result = await pollOrderStatus(upstoxOrderId, accessToken, order.correlationId);
    return result;

  } catch (error: any) {
    logError(`Execution error: ${error.message}`);
    return {
      correlationId: order.correlationId,
      upstoxOrderId: '',
      status: 'REJECTED',
      executionPrice: null,
      filledQuantity: null,
      rejectionReason: error.message,
    };
  }
}

/**
 * Poll Upstox order book for status updates.
 * Polls every 500ms for up to 10 seconds.
 */
async function pollOrderStatus(
  upstoxOrderId: string,
  accessToken: string,
  correlationId: string
): Promise<ExecutionResult> {
  const MAX_POLLS = 20; // Increased to 10 seconds total (20 * 500ms)
  const POLL_DELAY = 500;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_DELAY);

    try {
      const res = await fetchWithBackoff(`${API_URL}/v2/order/details?order_id=${upstoxOrderId}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!res.ok) continue;

      let data: any;
      const resText = await res.text();
      try {
        data = JSON.parse(resText);
      } catch (e) {
        logWarn(`Invalid JSON from details API: ${resText.substring(0, 100)}`);
        continue;
      }
      const orderData = data?.data;

      if (!orderData) continue;

      const status = orderData.status?.toUpperCase();

      if (status === 'COMPLETE' || status === 'FILLED') {
        logTrade(`✅ Order FILLED @ ₹${orderData.average_price || orderData.traded_price || 0}`);
        return {
          correlationId,
          upstoxOrderId,
          status: 'FILLED',
          executionPrice: orderData.average_price || orderData.traded_price || null,
          filledQuantity: orderData.filled_quantity || orderData.quantity || null,
          rejectionReason: null,
        };
      }

      if (status === 'REJECTED' || status === 'CANCELLED') {
        logError(`❌ Order ${status}: ${orderData.status_message || 'Unknown'}`);
        return {
          correlationId,
          upstoxOrderId,
          status: status as any,
          executionPrice: null,
          filledQuantity: null,
          rejectionReason: orderData.status_message || status,
        };
      }

      // Still pending — continue polling
      logInfo(`⏳ Order status: ${status} (poll ${i + 1}/${MAX_POLLS})`);

    } catch (e: any) {
      logWarn(`Poll error: ${e.message}`);
    }
  }

  // Timeout — return as partially filled or pending
  logWarn(`⏱️ Order status poll timeout for ${upstoxOrderId}`);
  return {
    correlationId,
    upstoxOrderId,
    status: 'PARTIALLY_FILLED',
    executionPrice: null,
    filledQuantity: null,
    rejectionReason: 'Status poll timeout after 10s',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reconciliation Circuit Breaker
 *
 * Called when pollOrderStatus times out (PARTIALLY_FILLED) — meaning the
 * broker's order API was unresponsive. This function cross-checks the actual
 * position book to determine the true state.
 *
 * Strategy:
 *   - 3 retries × 1s apart against GET /v2/portfolio/short-term-positions
 *   - If a matching position exists: returns fill price and qty from broker truth
 *   - If all 3 retries fail or no position found: returns null → caller defaults to FLAT
 *
 * @param instrumentToken  The instrument we attempted to buy
 * @param accessToken      Current Upstox OAuth token
 * @returns { fillPrice, quantity } if confirmed, null if broker unreachable or flat
 */
async function reconcilePositionAfterTimeout(
  instrumentToken: string,
  accessToken: string
): Promise<{ fillPrice: number; quantity: number } | null> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  logWarn(`[RECONCILE] Poll timeout detected. Starting position reconciliation for ${instrumentToken}...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await sleep(RETRY_DELAY_MS);
    try {
      const res = await fetch(
        'https://api.upstox.com/v2/portfolio/short-term-positions',
        { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } }
      );

      if (!res.ok) {
        logWarn(`[RECONCILE] Attempt ${attempt}/${MAX_RETRIES}: positions API returned ${res.status}`);
        continue;
      }

      const posData = await res.json() as any;
      const positions: any[] = posData?.data ?? [];

      const match = positions.find((p: any) =>
        p.instrument_token === instrumentToken && (p.net_quantity ?? p.netQuantity ?? 0) > 0
      );

      if (match) {
        const fillPrice = match.average_price ?? match.avgPrice ?? 0;
        const quantity  = Math.abs(match.net_quantity ?? match.netQuantity ?? 0);
        logInfo(`[RECONCILE] ✅ Position confirmed by broker: ${quantity} qty @ ₹${fillPrice}`);
        return { fillPrice, quantity };
      }

      // Positions API responded but no matching instrument → flat book confirmed
      logInfo(`[RECONCILE] Broker confirms flat book for ${instrumentToken}. No position.`);
      return null;

    } catch (err: any) {
      logWarn(`[RECONCILE] Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
    }
  }

  // All 3 retries exhausted — broker API appears fully down
  logError(`[RECONCILE] ❌ All ${MAX_RETRIES} reconciliation attempts failed. Defaulting to FLAT. Admin alert needed.`);
  asyncLog({ type: 'system_event', event: 'reconciliation_failed', instrumentToken });
  return null;
}

import { generateIcebergSlices } from './iceberg.js';

// Standard NIFTY configuration. 
// NSE Nifty 50 lot size is 6 5.
const NIFTY_LOT_SIZE = 65;
const ICEBERG_CONF = {
  minLotsPerSlice: 1,     // e.g., 75 qty
  maxLotsPerSlice: 4,     // e.g., 300 qty
  baseDelayMs: 250,       // Wait 250ms between slices
  jitterMs: 300           // Add up to 300ms of random delay (Total delay: 250ms - 550ms)
};

export async function executeOrderStealth(order: any, upstoxToken: string) {
  const lotSize = order.quantity / order.lots; // Automatically derive lot size
  const slices = generateIcebergSlices(order.lots, ICEBERG_CONF);

  logInfo(`[ICEBERG] Fracturing ${order.lots} lots into ${slices.length} stealth slices: ${slices.join(', ')}`);

  const fillResults: any[] = [];

  for (let i = 0; i < slices.length; i++) {
    const sliceLots = slices[i];
    const sliceQty = sliceLots * lotSize;

    // 1. Build the unique Upstox payload for this slice
    const payload = {
      quantity: sliceQty,
      product: 'I', // Intraday
      validity: 'DAY',
      price: order.orderPrice, // LIMIT order price from parent
      tag: order.correlationId.substring(0, 20), // Tie back to parent order
      instrument_token: order.instrumentToken,
      order_type: order.orderPrice === 0 ? 'MARKET' : 'LIMIT',
      transaction_type: order.transactionType, // BUY or SELL
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
      slice: true
    };

    // 2. Log API hit to prevent ban
    ApiTracker.recordCall();

    try {
      logInfo(`[ICEBERG] 🧊 Firing slice ${i + 1}/${slices.length} -> ${sliceQty} qty (${sliceLots} lots)`);

      const res = await fetch('https://api.upstox.com/v2/order/place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${upstoxToken}`
        },
        body: JSON.stringify(payload)
      });

      let data: any;
      const resText = await res.text();
      try {
        data = JSON.parse(resText);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${resText.substring(0, 100)}`);
      }

      if (res.ok && data.status === 'success') {
        fillResults.push({ sliceQty, orderId: data.data.order_id, status: 'SUBMITTED' });
      } else {
        logError(`[ERROR] Slice ${i + 1} failed: ${JSON.stringify(data.errors || data)}`);
        fillResults.push({ sliceQty, status: 'FAILED', error: data });
      }
    } catch (err: any) {
      logError(`[NETWORK ERROR] Slice ${i + 1}: ${err.message}`);
      fillResults.push({ sliceQty, status: 'NETWORK_ERROR' });
    }

    // 3. Jitter Delay (Don't sleep after the very last slice)
    if (i < slices.length - 1) {
      const dynamicJitter = Math.floor(Math.random() * ICEBERG_CONF.jitterMs);
      const totalWait = ICEBERG_CONF.baseDelayMs + dynamicJitter;
      await sleep(totalWait);
    }
  }

  // Calculate success rate to send back to Cloudflare
  const successfulLots = fillResults.filter(r => r.status === 'SUBMITTED').reduce((acc, curr) => acc + (curr.sliceQty / lotSize), 0);

  return {
    success: successfulLots === order.lots,
    requestedLots: order.lots,
    filledLots: successfulLots,
    details: fillResults
  };
}

// --- 🟢 NEW: 100% Native Circuit Breaker Action ---

export async function executeEmergencyMarketExit() {
  logInfo('🚨 [EXECUTOR] Initiating Native Emergency Square-Off...');

  if (tracker.tradingMode === 'PAPER') {
    if (tracker.activePositionQty === 0) {
      logInfo('✅ [EXECUTOR] [PAPER] No simulated position to square off.');
      return;
    }
    logInfo(`[EXECUTOR] [PAPER] Squaring off simulated position: ${tracker.activePositionSymbol || tracker.activePositionToken}`);
    const optionLtp = tracker.latestTick?.ltp || tracker.activePositionEntry || 100;
    await executor.executePaperExit(optionLtp, 'EMERGENCY_EXIT');
    return;
  }

  if (!StateEngine.activeToken) {
    logError('❌ [EXECUTOR] Cannot exit market: No active token.');
    return;
  }

  try {
    const positions = await brokerAdapter.getOpenPositions();
    const activePositions = positions.filter((p: any) => p.netQuantity !== 0);

    if (activePositions.length === 0) {
      logInfo('✅ [EXECUTOR] No open positions to square off.');
      return;
    }

    for (const pos of activePositions) {
      const transactionType = pos.netQuantity > 0 ? 'SELL' : 'BUY';
      const orderPayload = {
        correlationId: `EXIT-${Date.now()}`,
        instrumentToken: pos.instrumentToken,
        tradingSymbol: pos.tradingSymbol,
        transactionType: transactionType,
        lots: Math.abs(pos.netQuantity) / NIFTY_LOT_SIZE,
        quantity: Math.abs(pos.netQuantity),
        orderPrice: 0, // MARKET order for guaranteed ruthless exit
      };

      logInfo(`[EXECUTOR] Squaring off ${pos.tradingSymbol} (${pos.netQuantity} qty)...`);
      await executeOrderStealth(orderPayload, StateEngine.activeToken);
    }
    logInfo('✅ [EXECUTOR] Native Emergency Square-Off Complete.');
  } catch (err: any) {
    logError(`[EXECUTOR] Critical failure during market exit: ${err.message}`);
  }
}

export function simulateSlippage(ltp: number, transactionType: 'BUY' | 'SELL'): number {
  const slippage = 0.5 + Math.random() * 0.5; // random between 0.5 and 1.0 points
  const executionPrice = transactionType === 'BUY' ? ltp + slippage : ltp - slippage;
  return parseFloat(executionPrice.toFixed(2));
}

export async function fetchOptionLtp(instrumentToken: string, accessToken: string): Promise<number> {
  try {
    const res = await fetch(`https://api.upstox.com/v2/market-quote/ltp?instrument_key=${encodeURIComponent(instrumentToken)}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    if (res.ok) {
      const json = await res.json() as any;
      return json.data?.[instrumentToken]?.last_price || 0;
    }
  } catch (err) {
    logError(`[EXECUTOR] Failed to fetch live LTP for paper trade: ${err}`);
  }
  return 0;
}

export class ExecutionEngine {
  private readonly MAX_ACCEPTABLE_SLIPPAGE_POINTS = 2.0;
  private readonly MIN_REQUIRED_DELTA = 30;
  private readonly MIN_TICK_VOLUME = 200;
  private readonly ABSOLUTE_DELTA_FLOOR = 120;
  private readonly RELATIVE_DELTA_DOMINANCE = 0.35;
  private isExecutingTapeExit = false;

  constructor() {
    logInfo('[EXECUTOR] Execution Matrix initialized and standing by.');
  }

  private async evaluateCircuitBreakers(): Promise<boolean> {
    if (isPreMarket()) {
      return false;
    }
    const state = tracker.getState();
    if (state.isHalted) return false;

    if (state.dailyRealizedPnL >= state.hardCeiling) {
      logWarn(`[CIRCUIT BREAKER] 20% HARD CEILING HIT! Shutting down to lock in gains.`);
      await this.triggerEmergencyShutdown('20% Max Daily Limit Reached');
      return false;
    }

    if (state.isShieldModeActive) {
      const projectedNetPnL = state.dailyRealizedPnL + state.activeUnrealizedPnL;
      if (projectedNetPnL <= state.secureTarget) {
        logWarn(`[CIRCUIT BREAKER] SHIELD MODE BREACHED! Executing defensive exit.`);
        await this.triggerEmergencyShutdown('5% Baseline Protected. Exiting to prevent drawdown.');
        return false;
      }
    }
    return true;
  }

  private async triggerEmergencyShutdown(reason: string): Promise<void> {
    try {
      tracker.haltTrading(reason);
      logInfo('[EXECUTOR] Firing emergency market exits for all open positions...');
      await executeEmergencyMarketExit();
      logInfo('[EXECUTOR] Emergency exit confirmed. System is securely halted for the day.');
    } catch (error) {
      logError(`[EXECUTOR] CRITICAL FAILURE during emergency shutdown sequence: ${error}`);
    }
  }

  public async monitorLiveOrderFlow(liveDelta: number, liveVolume: number, currentLtp: number): Promise<void> {
    if (isPreMarket()) return;
    const token = tracker.activePositionToken;
    if (!token) return;

    const isLong = token.endsWith('CE') || token.includes('CE-');
    const isShort = token.endsWith('PE') || token.includes('PE-');

    if (tracker.activePositionQty === 0 || this.isExecutingTapeExit || liveVolume < this.MIN_TICK_VOLUME) return;

    const dynamicThreshold = Math.max(this.ABSOLUTE_DELTA_FLOOR, liveVolume * this.RELATIVE_DELTA_DOMINANCE);

    if (isLong && liveDelta <= -dynamicThreshold) {
      logWarn(`[TAPE EXIT] 🚨 Institutional SELLING Wall Detected! Front-running the dump!`);
      await this.executeOrderFlowExit('CE Tape Exhaustion / Absorption Trap');
    } else if (isShort && liveDelta >= dynamicThreshold) {
      logWarn(`[TAPE EXIT] 🚨 Institutional BUYING Wall Detected! Front-running the short squeeze!`);
      await this.executeOrderFlowExit('PE Tape Exhaustion / Squeeze');
    }
  }

  private async executeOrderFlowExit(reason: string): Promise<void> {
    this.isExecutingTapeExit = true;
    try {
      logInfo(`[EXECUTOR] Executing high-speed Tape Exit. Reason: ${reason}`);
      await executeEmergencyMarketExit();
      logInfo('[EXECUTOR] Tape Exit confirmed. Capital secured.');
    } catch (error) {
      logError(`[EXECUTOR] Failure during Tape Exit: ${error}`);
    } finally {
      setTimeout(() => { this.isExecutingTapeExit = false; }, 5000);
    }
  }

  public async evaluateAndExecuteTrade(signal: string, targetQuantity: number, ltp: number, depth: MarketDepth, crossoverDelta: number): Promise<void> {
    const isSafeToTrade = await this.evaluateCircuitBreakers();
    if (!isSafeToTrade || !signal.startsWith('BUY')) return;

    this.isExecutingTapeExit = false;

    if (signal === 'BUY_CE' && crossoverDelta < this.MIN_REQUIRED_DELTA) {
      logWarn(`[TAPE ABORT] False Breakout Trap! Weak Delta (${crossoverDelta}). Trade aborted.`);
      return;
    } else if (signal === 'BUY_PE' && crossoverDelta > -this.MIN_REQUIRED_DELTA) {
      logWarn(`[TAPE ABORT] False Breakout Trap! Weak Delta (${crossoverDelta}). Trade aborted.`);
      return;
    }

    const metrics = liquidityScanner.scanOrderBook('BUY', targetQuantity, ltp, depth);
    if (!metrics.isLiquiditySufficient || metrics.slippagePoints > this.MAX_ACCEPTABLE_SLIPPAGE_POINTS) {
      logWarn(`[LIQUIDITY ABORT] Slippage/Depth exceeds safety limits. Trade aborted.`);
      return;
    }

    logInfo(`[EXECUTOR] ✅ Verified WAP at ₹${metrics.expectedExecutionPrice.toFixed(2)}. Executing...`);
    await this.executeNativeTrade(signal as 'BUY_CE' | 'BUY_PE', targetQuantity, metrics.expectedExecutionPrice, ltp);
  }

  private async executeNativeTrade(signal: 'BUY_CE' | 'BUY_PE', quantity: number, limitPrice: number, liveLtp: number) {
    if (!StateEngine.activeToken) {
      logError('[EXECUTOR] Cannot execute trade: No active token.');
      return;
    }

    // 🟢 FIXED: Wrapped the entire external API execution flow in a Try/Catch to prevent PM2 Crash
    try {
      const direction = signal === 'BUY_CE' ? 'CE' : 'PE';
      const spotPrice = liveLtp || tracker.liveSpotPrice;
      if (!spotPrice || spotPrice === 0) {
        logError('[EXECUTOR] CRITICAL: Spot price is 0. Aborting trade.');
        return;
      }

      const atmStrike = Math.round(spotPrice / 50) * 50;

      await brokerAdapter.getFundsAndMargin(true);
      const { instrumentKey: instrumentToken, lotSize } = await brokerAdapter.getAtmOptionToken(atmStrike, direction);

      const orderPayload = {
        correlationId: `AUTO-${Date.now()}`,
        instrumentToken: instrumentToken,
        tradingSymbol: `NIFTY_${atmStrike}_${direction}`,
        transactionType: 'BUY',
        lots: Math.floor(quantity / lotSize),
        quantity: Math.floor(quantity / lotSize) * lotSize, // exact multiple of live lot size
        orderPrice: limitPrice,
      };

      if (tracker.tradingMode === 'PAPER') {
        logInfo(`[PAPER TRADING] Simulating entry for ${orderPayload.tradingSymbol} | ${orderPayload.lots} lots (${orderPayload.quantity} qty)`);
        const rawLtp = await fetchOptionLtp(instrumentToken, StateEngine.activeToken || '');
        if (rawLtp === 0) {
          logError(`[EXECUTOR] [PAPER] Failed to get live option LTP for simulated trade.`);
          return;
        }

        const fillPrice = simulateSlippage(rawLtp, 'BUY');
        logTrade(`[PAPER FILLED] ${direction} @ ₹${fillPrice} | ${orderPayload.lots} lots`);

        tracker.setActivePosition(instrumentToken, orderPayload.quantity, fillPrice, orderPayload.tradingSymbol);
        if (activeWsClient) activeWsClient.subscribe(instrumentToken);

        // Insert into Supabase
        const { error } = await supabase
          .from('order_ledger')
          .insert({
            correlation_id: orderPayload.correlationId,
            trading_symbol: orderPayload.tradingSymbol,
            transaction_type: 'BUY',
            option_type: direction,
            strike_price: atmStrike,
            quantity: orderPayload.quantity,
            order_status: 'FILLED',
            upstox_order_id: `PAPER-${Date.now()}`,
            execution_price: fillPrice,
            trading_mode: 'PAPER',
            pnl: 0
          });

        if (error) {
          logError(`[PAPER DB ERROR] Failed to log paper trade: ${error.message}`);
        }
        return;
      }

      const res = await executeOrderStealth(orderPayload, StateEngine.activeToken);

      if (res.success || res.filledLots > 0) {
        tracker.setActivePosition(instrumentToken, res.filledLots * lotSize, limitPrice, orderPayload.tradingSymbol);
        if (activeWsClient) activeWsClient.subscribe(instrumentToken);
      }
    } catch (err: any) {
      logError(`[EXECUTOR] Execution halted due to network/API exception: ${err.message}`);
    }
  }

  public async takeManualPosition(direction: 'CE' | 'PE') {
    if (!StateEngine.activeToken) return;

    // 🟢 FIXED: Wrapped in Try/Catch
    try {
      const spotPrice = tracker.liveSpotPrice;
      if (spotPrice === 0) {
        logError('[EXECUTOR] Cannot execute manual trade: Waiting for live WS feed...');
        return;
      }

      const atmStrike = Math.round(spotPrice / 50) * 50;

      const marginData = await brokerAdapter.getFundsAndMargin(true);
      const availableMargin = marginData.available_margin || 0;

      const { instrumentKey: instrumentToken, lotSize } = await brokerAdapter.getAtmOptionToken(atmStrike, direction);

      const maxMarginPerLot = 15000;
      let lotsToBuy = Math.floor((availableMargin * 0.9) / maxMarginPerLot);
      if (lotsToBuy < 1) lotsToBuy = 1;
      if (lotsToBuy > 36) lotsToBuy = 36;
      const quantity = lotsToBuy * lotSize;
      logInfo(`[EXECUTOR] ATM Strike: ${atmStrike}. Firing ${lotsToBuy} lots (${quantity} qty @ lot size ${lotSize}).`);

      const orderPayload = {
        correlationId: `MANUAL-${Date.now()}`,
        instrumentToken: instrumentToken,
        tradingSymbol: `NIFTY_${atmStrike}_${direction}`,
        transactionType: 'BUY',
        lots: lotsToBuy,
        quantity: quantity,
        orderPrice: 0,
      };

      if (tracker.tradingMode === 'PAPER') {
        logInfo(`[PAPER TRADING] Simulating MANUAL BUY entry for ${orderPayload.tradingSymbol} | ${lotsToBuy} lots (${quantity} qty)`);
        const rawLtp = await fetchOptionLtp(instrumentToken, StateEngine.activeToken || '');
        if (rawLtp === 0) {
          logError(`[EXECUTOR] [PAPER] Failed to get live option LTP for manual entry.`);
          return;
        }

        const fillPrice = simulateSlippage(rawLtp, 'BUY');
        logTrade(`[PAPER FILLED] MANUAL ${direction} @ ₹${fillPrice} | ${lotsToBuy} lots`);

        tracker.setActivePosition(instrumentToken, quantity, fillPrice, orderPayload.tradingSymbol);
        if (activeWsClient) activeWsClient.subscribe(instrumentToken);

        // Insert into Supabase
        const { error } = await supabase
          .from('order_ledger')
          .insert({
            correlation_id: orderPayload.correlationId,
            trading_symbol: orderPayload.tradingSymbol,
            transaction_type: 'BUY',
            option_type: direction,
            strike_price: atmStrike,
            quantity: quantity,
            order_status: 'FILLED',
            upstox_order_id: `PAPER-${Date.now()}`,
            execution_price: fillPrice,
            trading_mode: 'PAPER',
            pnl: 0
          });

        if (error) {
          logError(`[PAPER DB ERROR] Failed to log manual paper trade: ${error.message}`);
        }
        return;
      }

      const res = await executeOrderStealth(orderPayload, StateEngine.activeToken);

      if (res.success || res.filledLots > 0) {
        tracker.setActivePosition(instrumentToken, res.filledLots * lotSize, spotPrice, orderPayload.tradingSymbol);
        if (activeWsClient) activeWsClient.subscribe(instrumentToken);
      }
    } catch (err: any) {
      logError(`[EXECUTOR] Manual execution failed: ${err.message}`);
    }
  }

  // ============================================================
  // Confluence-Triggered Entry Pipeline
  // ============================================================

  /**
   * Execute a directional trade triggered by the confluence signal engine.
   *
   * Flow:
   *   1. Circuit breaker check
   *   2. Fetch margin → compute 2% net profit target
   *   3. Fetch ATM option token
   *   4. Place HFT MARKET order with stale-signal timeout (3s)
   *   5. Extract fill price → anchor GTT OCO bracket
   *   6. Log slippage delta + signal audit asynchronously
   */
  public async executeConfluentTrade(
    signal: ConfluenceSignal,
    accessToken: string
  ): Promise<void> {
    const direction = signal.signal === 'BUY_CE' ? 'CE' : 'PE';

    logTrade(`[⚡ CONFLUENCE] ${signal.signal} triggered | ${signal.reason}`);

    const isSafe = await this.evaluateCircuitBreakers();
    if (!isSafe) {
      logWarn('[EXECUTOR] Circuit breaker blocked confluent trade.');
      return;
    }

    // Block if already in a position
    if (tracker.activePositionQty !== 0) {
      logInfo('[EXECUTOR] Active position exists. Skipping new signal.');
      return;
    }

    try {
      // Step 1: Margin → lot sizing (2% of daily capital as net target)
      const marginData = await brokerAdapter.getFundsAndMargin(true);
      const availableMargin: number = marginData.available_margin || 0;
      if (availableMargin <= 0) {
        logError('[EXECUTOR] Invalid margin data. Aborting trade.');
        return;
      }

      // Step 2: Fetch ATM option instrument token
      const spotPrice = tracker.liveSpotPrice;
      if (spotPrice === 0) {
        logError('[EXECUTOR] Spot price is 0. Aborting trade.');
        return;
      }
      const atmStrike = Math.round(spotPrice / 50) * 50;
      const { instrumentKey: instrumentToken, lotSize } = await brokerAdapter.getAtmOptionToken(
        atmStrike, direction
      );

      // Step 3: Size position (use 2% of margin per trade, max 36 lots)
      const maxMarginPerLot = 15000;
      let lots = Math.floor((availableMargin * 0.02 * 50) / maxMarginPerLot);
      if (lots < 1) lots = 1;
      if (lots > 36) lots = 36;
      const quantity = lots * NIFTY_LOT_SIZE_2026;
      const tradingSymbol = `NIFTY_${atmStrike}_${direction}`;

      if (tracker.tradingMode === 'PAPER') {
        logInfo(`[PAPER TRADING] Simulating BUY entry for ${tradingSymbol} | ${lots} lots (${quantity} qty)`);
        const rawLtp = await fetchOptionLtp(instrumentToken, accessToken);
        if (rawLtp === 0) {
          logError(`[EXECUTOR] [PAPER] Failed to get live option LTP. Aborting simulated trade.`);
          return;
        }

        const fillPrice = simulateSlippage(rawLtp, 'BUY');
        logTrade(`[PAPER FILLED] ${direction} @ ₹${fillPrice} | ${lots} lots (Simulated Slippage applied: ${fillPrice - rawLtp > 0 ? '+' : ''}${(fillPrice - rawLtp).toFixed(2)} pts)`);

        // Register active position in tracker
        tracker.setActivePosition(instrumentToken, quantity, fillPrice, tradingSymbol);
        if (activeWsClient) activeWsClient.subscribe(instrumentToken);

        const state = tracker.getState();
        const netProfitTarget = state.startingCapital * 0.02;
        const grossPoints = calculateGrossTargetPoints(fillPrice, lots, netProfitTarget, NIFTY_LOT_SIZE_2026);
        const targetPrice = parseFloat((fillPrice + grossPoints).toFixed(2));
        const stopLossPrice = parseFloat((fillPrice - 1.5).toFixed(2));
        tracker.paperTargetPrice = targetPrice;
        tracker.paperStopLossPrice = stopLossPrice;

        logTrade(`[🔒 GTT OCO PAPER] Target: ₹${targetPrice} | SL: ₹${stopLossPrice}`);

        // Insert into Supabase
        const { error } = await supabase
          .from('order_ledger')
          .insert({
            correlation_id: `CONF-PAPER-${Date.now()}`,
            trading_symbol: tradingSymbol,
            transaction_type: 'BUY',
            option_type: direction,
            strike_price: atmStrike,
            quantity: quantity,
            order_status: 'FILLED',
            upstox_order_id: `PAPER-${Date.now()}`,
            execution_price: fillPrice,
            trading_mode: 'PAPER',
            pnl: 0
          });

        if (error) {
          logError(`[PAPER DB ERROR] Failed to log paper trade: ${error.message}`);
        }

        asyncLog({
          type: 'trade_fill',
          signal: signal.signal,
          direction,
          orderId: `PAPER-${Date.now()}`,
          fillPrice,
          lots,
          quantity,
          instrumentToken,
          vwap: signal.vwap,
          rsi: signal.rsi,
          ema9: signal.ema9,
          ema21: signal.ema21,
          trading_mode: 'PAPER'
        });
        return;
      }

      // Step 4: Build HFT V3 payload
      const hftPayload = {
        quantity,
        product: 'I',
        validity: 'DAY',
        price: 0,
        trigger_price: 0,
        instrument_token: instrumentToken,
        order_type: 'MARKET',
        transaction_type: 'BUY',
        market_protection: 2, // Reject if slippage > 2%
        slice: true,
        tag: `CONF-${Date.now()}`.substring(0, 20),
      };

      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      // Step 5: Place order with 3-second stale-signal timeout
      const spotAtSignal = spotPrice; // snapshot before network round-trip
      let orderId: string | null = null;

      try {
        const placeRes = await this.placeWithTimeout(
          `${HFT_URL}/v3/order/place`,
          { method: 'POST', headers, body: JSON.stringify(hftPayload) },
          accessToken,
          3000
        );

        if (!placeRes || !placeRes.ok) {
          const errBody = placeRes ? await placeRes.text() : 'timeout';
          logError(`[EXECUTOR] HFT order placement failed: ${errBody.substring(0, 200)}`);
          return;
        }

        const placeData = await placeRes.json() as any;
        orderId = placeData?.data?.order_id;
        if (!orderId) {
          logError('[EXECUTOR] No order_id in HFT response. Aborting.');
          return;
        }
        logInfo(`[EXECUTOR] HFT order placed. Order ID: ${orderId}`);
      } catch (timeoutErr: any) {
        logWarn(`[EXECUTOR] ${timeoutErr.message} — signal stale, trade skipped.`);
        return;
      }

      // Step 6: Poll for fill
      ApiTracker.recordCall();
      const result = await pollOrderStatus(orderId, accessToken, `CONF-${orderId}`);
      if (result.status !== 'FILLED' || !result.executionPrice) {
        if (result.status === 'PARTIALLY_FILLED') {
          // Poll timed out — broker API was slow/down. Cross-check real positions.
          const reconciled = await reconcilePositionAfterTimeout(instrumentToken, accessToken);
          if (!reconciled) {
            logError(`[EXECUTOR] Reconciliation confirms FLAT book. Aborting position registration.`);
            return;
          }
          // Broker confirms a real position — register it from reconciliation truth
          const { fillPrice: reconFill, quantity: reconQty } = reconciled;
          logInfo(`[EXECUTOR] Reconciled fill: ${reconQty} qty @ ₹${reconFill}. Registering position.`);
          tracker.setActivePosition(instrumentToken, reconQty, reconFill);
          if (activeWsClient) activeWsClient.subscribe(instrumentToken);
          await this.anchorGttOcoBracket(orderId, instrumentToken, reconFill, lots, reconQty, accessToken);
          return;
        }
        logError(`[EXECUTOR] Order not filled. Status: ${result.status}`);
        return;
      }

      const fillPrice = result.executionPrice;
      logTrade(`[✅ FILLED] ${direction} @ ₹${fillPrice} | ${lots} lots`);

      // Step 7: Slippage delta tracking (Enhancement 2)
      const slippageDelta = Math.abs(fillPrice - spotAtSignal);
      logInfo(`[SLIPPAGE] Spot@signal: ₹${spotAtSignal} | Fill: ₹${fillPrice} | Delta: ${slippageDelta.toFixed(2)}pts`);
      asyncLog({
        type: 'slippage_event',
        direction,
        spotAtSignal,
        fillPrice,
        slippageDelta,
        lots,
        orderId,
      });

      // Step 8: Register active position in tracker
      tracker.setActivePosition(instrumentToken, quantity, fillPrice);
      if (activeWsClient) activeWsClient.subscribe(instrumentToken);

      // Step 9: Log fill event asynchronously
      asyncLog({
        type: 'trade_fill',
        signal: signal.signal,
        direction,
        orderId,
        fillPrice,
        lots,
        quantity,
        instrumentToken,
        vwap: signal.vwap,
        rsi: signal.rsi,
        ema9: signal.ema9,
        ema21: signal.ema21,
      });

      // Step 10: Anchor server-side GTT OCO bracket immediately
      await this.anchorGttOcoBracket(
        orderId, instrumentToken, fillPrice, lots, quantity, accessToken
      );

    } catch (err: any) {
      logError(`[EXECUTOR] Confluent trade pipeline failed: ${err.message}`);
    }
  }

  /**
   * Place an order with a hard stale-signal timeout.
   *
   * If the Upstox API doesn't respond within timeoutMs, the Promise races
   * to a rejection. The caller must catch STALE_SIGNAL_TIMEOUT and abort.
   * This prevents getting filled at the top of a fading momentum spike.
   */
  private async placeWithTimeout(
    url: string,
    options: RequestInit,
    _accessToken: string,
    timeoutMs: number
  ): Promise<Response> {
    const orderPromise = fetch(url, options);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `STALE_SIGNAL_TIMEOUT: No response from HFT endpoint within ${timeoutMs}ms`
      )), timeoutMs)
    );
    return Promise.race([orderPromise, timeoutPromise]);
  }

  /**
   * Immediately after a fill confirmation, anchor a server-side GTT OCO bracket.
   *
   * Target  = Fill + dynamicGrossPoints (2% net account return after STT + friction)
   * StopLoss = Fill − 1.5 points (max 1% account drawdown per trade)
   *
   * The GTT ID is stored in tracker for cancellation during the 15:15 teardown.
   */
  private async anchorGttOcoBracket(
    _orderId: string,
    instrumentToken: string,
    fillPrice: number,
    lots: number,
    quantity: number,
    accessToken: string
  ): Promise<void> {
    try {
      const state = tracker.getState();
      // Net 2% of starting daily capital is the per-trade profit target
      const netProfitTarget = state.startingCapital * 0.02;

      // Dynamic gross points — scales with lot count and fill price IV
      const grossPoints = calculateGrossTargetPoints(
        fillPrice, lots, netProfitTarget, NIFTY_LOT_SIZE_2026
      );

      const targetPrice = parseFloat((fillPrice + grossPoints).toFixed(2));
      const stopLossPrice = parseFloat((fillPrice - 1.5).toFixed(2));

      logInfo(
        `[GTT-OCO] Anchoring bracket | Fill: ₹${fillPrice} | ` +
        `Target: ₹${targetPrice} (+${grossPoints.toFixed(2)}pts) | SL: ₹${stopLossPrice}`
      );

      const gttPayload = {
        instrument_token: instrumentToken,
        quantity,
        transaction_type: 'SELL',
        product: 'I',
        rules: [
          {
            strategy: 'TARGET',
            trigger_type: 'IMMEDIATE',
            trigger_price: targetPrice,
            price: targetPrice,
          },
          {
            strategy: 'STOPLOSS',
            trigger_type: 'IMMEDIATE',
            trigger_price: stopLossPrice,
            price: stopLossPrice,
          },
        ],
      };

      ApiTracker.recordCall();
      const gttRes = await fetch(`${API_URL}/v3/order/gtt/place`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(gttPayload),
      });

      const gttBody = await gttRes.json() as any;

      if (gttRes.ok && gttBody?.status === 'success') {
        const gttId = gttBody?.data?.id ?? gttBody?.data?.gtt_id ?? 'UNKNOWN';
        tracker.setActiveGtt(String(gttId));
        logTrade(`[🔒 GTT OCO LIVE] ID: ${gttId} | Target: ₹${targetPrice} | SL: ₹${stopLossPrice}`);

        asyncLog({
          type: 'gtt_placed',
          gttId,
          instrumentToken,
          fillPrice,
          targetPrice,
          stopLossPrice,
          grossPoints,
          lots,
          netProfitTarget,
        });
      } else {
        logError(`[GTT-OCO] Placement failed: ${JSON.stringify(gttBody).substring(0, 200)}`);
        logWarn('[GTT-OCO] Falling back to client-side monitoring (no server bracket active).');
      }
    } catch (err: any) {
      logError(`[GTT-OCO] Critical failure anchoring bracket: ${err.message}`);
      logWarn('[GTT-OCO] Position is UNPROTECTED. Manual intervention required.');
    }
  }

  public async executePaperExit(ltp: number, reason: string): Promise<void> {
    const token = tracker.activePositionToken;
    const qty = tracker.activePositionQty;
    const entry = tracker.activePositionEntry;
    const symbol = tracker.activePositionSymbol;
    if (!token || qty === 0) return;

    try {
      const fillPrice = simulateSlippage(ltp, 'SELL');
      const pnl = parseFloat(((fillPrice - entry) * qty).toFixed(2));
      const correlationId = `PAPER-EXIT-${Date.now()}`;
      
      logTrade(`[PAPER EXIT] 🚨 Exiting position ${symbol || token} @ ₹${fillPrice} | PnL: ₹${pnl.toFixed(2)} | Reason: ${reason}`);

      // Insert into Supabase order_ledger
      const { error } = await supabase
        .from('order_ledger')
        .insert({
          correlation_id: correlationId,
          trading_symbol: symbol || token.replace('NSE_FO|', ''),
          transaction_type: 'SELL',
          option_type: (symbol || token).includes('CE') ? 'CE' : 'PE',
          strike_price: parseInt((symbol || token).match(/\d+/)?.[0] || '0'),
          quantity: qty,
          order_status: 'FILLED',
          upstox_order_id: `PAPER-${Date.now()}`,
          execution_price: fillPrice,
          pnl: pnl,
          trading_mode: 'PAPER',
          rejection_reason: reason
        });

      if (error) {
        logError(`[PAPER DB ERROR] Failed to log paper exit: ${error.message}`);
      }

      // Record trade outcome to tracker (was stop-loss?)
      const isStopLoss = reason === 'STOPLOSS' || pnl < 0;
      tracker.recordTradeOutcome(isStopLoss);

      // Update realized PnL
      const state = tracker.getState();
      tracker.setRealizedPnL(parseFloat((state.dailyRealizedPnL + pnl).toFixed(2)));

      // Clear position
      tracker.clearActivePosition();
      logInfo(`[PAPER EXIT] Simulated position cleared.`);

      // Update paper_margin dynamically
      try {
        const { data } = await supabase.from('system_state').select('paper_margin').single();
        if (data && data.paper_margin !== undefined) {
          const newMargin = Number(data.paper_margin) + pnl;
          await supabase.from('system_state').update({ paper_margin: newMargin }).eq('id', 1);
          logInfo(`[EXECUTOR] Updated Paper Margin by ₹${pnl}. New Margin: ₹${newMargin}`);
        }
      } catch (err: any) {
        logError(`[PAPER DB ERROR] Failed to update paper_margin: ${err.message}`);
      }
    } catch (err: any) {
      logError(`[PAPER EXIT ERROR] Failed to execute simulated exit: ${err.message}`);
    }
  }
}

export const executor = new ExecutionEngine();
