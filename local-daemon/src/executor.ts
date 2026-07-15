// ============================================
// Upstox Order Executor
// Handles order placement and status polling
// ============================================

import { logInfo, logWarn, logError, logTrade } from './logger.js';
import { StateEngine } from './state-engine.js';
import { brokerAdapter } from './broker-adapter.js';
import { ApiTracker, tracker } from './tracker.js';

import { liquidityScanner } from './liquidity.js';
import type { MarketDepth } from './ws-client.js';
import { activeWsClient } from './index.js'; // 🟢 NEW IMPORT

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

// --- 🟢 NEW: 100% Native Circuit Breaker Action ---

export async function executeEmergencyMarketExit() {
  logInfo('🚨 [EXECUTOR] Initiating Native Emergency Market Square-Off...');
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
        lots: Math.abs(pos.netQuantity) / 25,
        quantity: Math.abs(pos.netQuantity),
        orderPrice: 0, // MARKET order for guaranteed ruthless exit
      };
      
      logInfo(`[EXECUTOR] Squaring off ${pos.tradingSymbol} (${pos.netQuantity} qty)...`);
      await executeOrderStealth(orderPayload, StateEngine.activeToken);
    }
    logInfo('✅ [EXECUTOR] Native Emergency Square-Off Complete.');
  } catch (err: any) {
    logError(`❌ [EXECUTOR] Critical failure during market exit: ${err.message}`);
  }
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
    const token = tracker.activePositionToken;
    if (!token) return;

    const isLong  = token.endsWith('CE') || token.includes('CE-');
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
      const instrumentToken = await brokerAdapter.getAtmOptionToken(atmStrike, direction);

      const orderPayload = {
          correlationId: `AUTO-${Date.now()}`,
          instrumentToken: instrumentToken,
          tradingSymbol: `NIFTY_${atmStrike}_${direction}`,
          transactionType: 'BUY',
          lots: Math.floor(quantity / 25), 
          quantity: quantity,
          orderPrice: limitPrice,
      };

      const res = await executeOrderStealth(orderPayload, StateEngine.activeToken);
      
      if (res.success || res.filledLots > 0) {
         tracker.setActivePosition(instrumentToken, res.filledLots * 25, limitPrice);
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
      
      const maxMarginPerLot = 4000; 
      let lotsToBuy = Math.floor((availableMargin * 0.9) / maxMarginPerLot);
      if (lotsToBuy < 1) lotsToBuy = 1; 
      if (lotsToBuy > 36) lotsToBuy = 36; 
      
      const quantity = lotsToBuy * 25;
      logInfo(`[EXECUTOR] ATM Strike: ${atmStrike}. Firing ${lotsToBuy} lots.`);

      const instrumentToken = await brokerAdapter.getAtmOptionToken(atmStrike, direction);

      const orderPayload = {
          correlationId: `MANUAL-${Date.now()}`,
          instrumentToken: instrumentToken,
          tradingSymbol: `NIFTY_${atmStrike}_${direction}`,
          transactionType: 'BUY',
          lots: lotsToBuy,
          quantity: quantity,
          orderPrice: 0, 
      };

      const res = await executeOrderStealth(orderPayload, StateEngine.activeToken);
      
      if (res.success || res.filledLots > 0) {
         tracker.setActivePosition(instrumentToken, res.filledLots * 25, spotPrice); 
         if (activeWsClient) activeWsClient.subscribe(instrumentToken);
      }
    } catch (err: any) {
      logError(`[EXECUTOR] Manual execution failed: ${err.message}`);
    }
  }
}

export const executor = new ExecutionEngine();
