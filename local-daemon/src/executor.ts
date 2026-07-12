// ============================================
// Upstox Order Executor
// Handles order placement and status polling
// ============================================

import { logInfo, logWarn, logError, logTrade } from './logger.js';
import { ApiTracker, tracker } from './tracker.js';
import { executeEmergencyMarketExit } from './iceberg.js';
import { liquidityScanner } from './liquidity.js';
import type { MarketDepth } from './ws-client.js';

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

    const placeData: any = await placeRes.json();
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

      const data: any = await res.json();
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

import { generateIcebergSlices } from './iceberg.js';

// Standard NIFTY configuration. 
// Freeze limit is 1800 qty (72 lots). We keep max slices stealthy at 15 lots (375 qty).
const ICEBERG_CONF = {
  minLotsPerSlice: 4,     // e.g., 100 qty
  maxLotsPerSlice: 15,    // e.g., 375 qty
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
      logInfo(`[ICEBERG] 🧊 Firing slice ${i+1}/${slices.length} -> ${sliceQty} qty (${sliceLots} lots)`);
      
      const res = await fetch('https://api.upstox.com/v2/order/place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${upstoxToken}`
        },
        body: JSON.stringify(payload)
      });

      const data: any = await res.json();
      
      if (res.ok && data.status === 'success') {
        fillResults.push({ sliceQty, orderId: data.data.order_id, status: 'SUBMITTED' });
      } else {
        logError(`[ERROR] Slice ${i+1} failed: ${JSON.stringify(data.errors || data)}`);
        fillResults.push({ sliceQty, status: 'FAILED', error: data });
      }
    } catch (err: any) {
      logError(`[NETWORK ERROR] Slice ${i+1}: ${err.message}`);
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

// --- Circuit Breaker Actions ---

export async function executeMarketExitAll(workerUrl: string, secret: string) {
  try {
    logInfo('🚨 Triggering emergency market square-off via Cloudflare...');
    const res = await fetch(`${workerUrl}/api/emergency-squareoff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from('vdineshprabu:Healthywealth007#').toString('base64')
      },
      body: JSON.stringify({ secret }) // Depending on auth
    });
    
    if (res.ok) {
      logInfo('✅ Emergency square-off dispatched to queue.');
    } else {
      const err = await res.text();
      logError(`❌ Emergency square-off failed: ${err}`);
    }
  } catch (err: any) {
    logError(`❌ Emergency square-off network error: ${err.message}`);
  }
}

export async function haltTradingSession(workerUrl: string, secret: string, reason: string) {
  try {
    logInfo(`🚨 Halting Trading Session: ${reason}`);
    await fetch(`${workerUrl}/api/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Poll-Secret': secret
      },
      body: JSON.stringify({ action: 'EMERGENCY_HALT', reason })
    });
  } catch (err: any) {
    logError(`❌ Failed to halt trading session: ${err.message}`);
  }
}

export class ExecutionEngine {
  private readonly MAX_ACCEPTABLE_SLIPPAGE_POINTS = 2.0;
  
  // 🚨 NEW: The minimum aggressive net tick delta required to validate a trade.
  // Example: '30' means we need at least 30 MORE aggressive buys than sells inside the 1-minute candle.
  private readonly MIN_REQUIRED_DELTA = 30; 

  constructor() {
    logInfo('[EXECUTOR] Execution Matrix initialized and standing by.');
  }

  private async evaluateCircuitBreakers(): Promise<boolean> {
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

  /**
   * Master Entry Gatekeeper - Now upgraded with Institutional Order Flow (Delta)
   */
  public async evaluateAndExecuteTrade(
    signal: string,
    targetQuantity: number,
    ltp: number,
    depth: MarketDepth,
    crossoverDelta: number // 🚀 Incoming Delta from WS Client
  ): Promise<void> {
    
    // 1. Check macro structural safety (Capital Preservation)
    const isSafeToTrade = await this.evaluateCircuitBreakers();
    if (!isSafeToTrade) return;

    if (!signal.startsWith('BUY')) return;

    logInfo(`[EXECUTOR] ${signal} signal generated. Evaluating Order Flow Convergence...`);

    // ========================================================================
    // 2. ORDER FLOW CONVERGENCE CHECK (Institutional Trap Evasion)
    // ========================================================================
    if (signal === 'BUY_CE') {
      // MACD says UP, but Delta must confirm aggressive institutional BUYING
      if (crossoverDelta < this.MIN_REQUIRED_DELTA) {
        logWarn(
          `[TAPE ABORT] False Breakout Trap! MACD fired BUY_CE, but order flow delta is weak/negative (${crossoverDelta}). ` +
          `Smart money is absorbing the buying pressure. Trade aborted.`
        );
        return;
      }
    } else if (signal === 'BUY_PE') {
      // MACD says DOWN, but Delta must confirm aggressive institutional SELLING
      if (crossoverDelta > -this.MIN_REQUIRED_DELTA) {
        logWarn(
          `[TAPE ABORT] False Breakout Trap! MACD fired BUY_PE, but order flow delta is weak/positive (${crossoverDelta}). ` +
          `Smart money is absorbing the selling pressure. Trade aborted.`
        );
        return;
      }
    }

    logInfo(`[EXECUTOR] 🎯 Order Flow Confirmed! Institutional Delta: ${crossoverDelta}. X-Raying liquidity...`);

    // 3. X-Ray the Order Book (Pre-Trade Slippage Abort)
    const metrics = liquidityScanner.scanOrderBook('BUY', targetQuantity, ltp, depth);

    if (!metrics.isLiquiditySufficient) {
      logWarn(`[LIQUIDITY ABORT] Insufficient market depth. Trade aborted.`);
      return; 
    }

    if (metrics.slippagePoints > this.MAX_ACCEPTABLE_SLIPPAGE_POINTS) {
      logWarn(`[LIQUIDITY ABORT] Expected slippage (₹${metrics.slippagePoints.toFixed(2)}) exceeds max limit. Trade aborted.`);
      return;
    }

    // 4. Execution Clearance Granted
    logInfo(`[EXECUTOR] ✅ Verified WAP at ₹${metrics.expectedExecutionPrice.toFixed(2)}. Dispatching to cloud...`);

    await this.dispatchToCloud(signal, targetQuantity, metrics.expectedExecutionPrice);
  }

  private async dispatchToCloud(signal: string, quantity: number, verifiedWap: number): Promise<void> {
    const workerUrl = process.env.CLOUD_WORKER_URL || '';
    const pollSecret = process.env.POLL_SECRET || '';
    if (!workerUrl) {
      logWarn('[EXECUTOR] CLOUD_WORKER_URL not configured. Cannot dispatch signal.');
      return;
    }
    try {
      const response = await fetch(`${workerUrl}/api/signal-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: pollSecret,
          signal,
          quantity,
          executionPrice: verifiedWap,
          timestamp: new Date().toISOString()
        })
      });
      if (response.ok) {
        logInfo(`[EXECUTOR] Secured signal ${signal} successfully dispatched to cloud.`);
      } else {
        const errText = await response.text();
        logError(`[EXECUTOR] Failed to dispatch signal to cloud: ${response.status} - ${errText}`);
      }
    } catch (err: any) {
      logError(`[EXECUTOR] Network error dispatching signal to cloud: ${err.message}`);
    }
  }

  public async processTick(tickData: any): Promise<void> {
    const isSafeToTrade = await this.evaluateCircuitBreakers();
    if (!isSafeToTrade) return;
  }
}

export const executor = new ExecutionEngine();
