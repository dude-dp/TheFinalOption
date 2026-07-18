// local-daemon/src/iceberg.ts

import { logger } from './logger.js';
// Assuming your broker adapter is implemented to handle direct Upstox execution
import { brokerAdapter } from './broker-adapter.js'; 

export interface IcebergConfig {
  minLotsPerSlice: number;
  maxLotsPerSlice: number;
  baseDelayMs: number;
  jitterMs: number;
}

/**
 * Normal execution: Fractures a large order into randomized chunks with time delays to mask footprint.
 */
export function generateIcebergSlices(totalLots: number, config: IcebergConfig): number[] {
  if (totalLots <= config.maxLotsPerSlice) {
    return [totalLots]; 
  }

  const slices: number[] = [];
  let remaining = totalLots;

  while (remaining > 0) {
    if (remaining <= config.maxLotsPerSlice) {
      slices.push(remaining);
      break;
    }

    let slice = Math.floor(Math.random() * (config.maxLotsPerSlice - config.minLotsPerSlice + 1)) + config.minLotsPerSlice;

    if (remaining - slice < config.minLotsPerSlice) {
      slices.push(remaining);
      break;
    } else {
      slices.push(slice);
      remaining -= slice;
    }
  }

  return slices;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 🚨 RUTHLESS EMERGENCY EXIT 🚨
 * Bypasses all standard iceberg randomization, delays, and limit-order slippage checks.
 * Slices strictly to meet Exchange Freeze Limits (e.g., NIFTY 1800) and blasts them 
 * simultaneously as MARKET orders.
 */
export async function executeEmergencyMarketExit(): Promise<void> {
  logger.warn('[ICEBERG] 🚨 EMERGENCY MARKET EXIT TRIGGERED. BYPASSING ICEBERG DELAYS.');
  
  try {
    // 1. Fetch all currently open positions from the broker adapter
    const positions = await brokerAdapter.getOpenPositions();
    const activePositions = positions.filter(pos => pos.netQuantity !== 0);
    
    if (activePositions.length === 0) {
      logger.info('[ICEBERG] No active positions to square off.');
      return;
    }

    const exitPromises = activePositions.map(async (pos) => {
       // We MUST respect exchange freeze limits (e.g., Nifty 1800 quantity)
       const MAX_FREEZE_QTY = 1800; 
       let remainingQty = Math.abs(pos.netQuantity);
       const exitTransactionType = pos.netQuantity > 0 ? 'SELL' : 'BUY';

       const slices: number[] = [];
       while(remainingQty > 0) {
          const sliceQty = Math.min(remainingQty, MAX_FREEZE_QTY);
          slices.push(sliceQty);
          remainingQty -= sliceQty;
       }

       logger.warn(
         `[ICEBERG] Squaring off ${pos.tradingSymbol} - Qty: ${Math.abs(pos.netQuantity)} ` +
         `in ${slices.length} concurrent chunks via MARKET execution.`
       );

       // 2. Blast all slices concurrently. NO sleep. NO limit prices.
       // Promise.all ensures they hit the broker's API layer almost exactly simultaneously.
       const orderPromises = slices.map(sliceQty => 
          brokerAdapter.placeOrder({
             tradingSymbol: pos.tradingSymbol,
             instrumentToken: pos.instrumentToken,
             transactionType: exitTransactionType,
             orderType: 'MARKET',  // Overriding standard limits
             quantity: sliceQty,
             product: pos.product || 'MIS',
             isEmergency: true // Flags the broker adapter to skip pre-trade validations
          })
       );

       return Promise.all(orderPromises);
    });

    // Wait for all positions across all slices to be fired
    await Promise.all(exitPromises);
    logger.info('[ICEBERG] ✅ All emergency MARKET exit orders dispatched to exchange.');

  } catch (error) {
    logger.error(`[ICEBERG] CRITICAL FAILURE during emergency exit execution: ${error}`);
    throw error;
  }
}
