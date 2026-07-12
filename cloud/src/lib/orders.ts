// cloud/src/lib/orders.ts

import type { OrderPayload } from './types';
import { KV_KEYS } from './types';

export async function addPendingOrder(kv: KVNamespace, order: OrderPayload): Promise<void> {
  const raw = await kv.get(KV_KEYS.PENDING_ORDERS);
  const list: OrderPayload[] = raw ? JSON.parse(raw) : [];
  
  if (list.some(o => o.correlationId === order.correlationId)) {
    return;
  }
  
  list.push(order);
  await kv.put(KV_KEYS.PENDING_ORDERS, JSON.stringify(list));
}

export async function removePendingOrder(kv: KVNamespace, correlationId: string): Promise<void> {
  const raw = await kv.get(KV_KEYS.PENDING_ORDERS);
  if (!raw) return;
  const list: OrderPayload[] = JSON.parse(raw);
  const updated = list.filter(o => o.correlationId !== correlationId);
  await kv.put(KV_KEYS.PENDING_ORDERS, JSON.stringify(updated));
}

/**
 * Standard Order Dispatch (Used for normal entries/exits)
 */
export async function queueOrDispatchOrder(env: any, order: OrderPayload, niftyLotSize: number): Promise<void> {
  const MAX_NIFTY_FREEZE_QUANTITY = 1800;
  const maxLotsPerOrder = Math.floor(MAX_NIFTY_FREEZE_QUANTITY / niftyLotSize);

  if (order.lots > maxLotsPerOrder) {
    let remainingLots = order.lots;
    let sliceIndex = 1;

    // Normal orders are dispatched to the queue sequentially
    while (remainingLots > 0) {
      const sliceLots = Math.min(remainingLots, maxLotsPerOrder);
      const sliceQuantity = sliceLots * niftyLotSize;
      
      const sliceOrder: OrderPayload = {
        ...order,
        orderId: crypto.randomUUID(),
        correlationId: `${order.correlationId}_s${sliceIndex}`,
        lots: sliceLots,
        quantity: sliceQuantity,
      };

      await env.ORDER_QUEUE.send({
        type: 'DISPATCH_SLICED_ORDER',
        correlationId: sliceOrder.correlationId,
        payload: { order: sliceOrder }
      });

      remainingLots -= sliceLots;
      sliceIndex++;
    }
  } else {
    await addPendingOrder(env.TRADING_KV, order);
    await env.TRADING_DB.prepare(
      `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      order.orderId, order.correlationId, order.instrumentToken, order.tradingSymbol,
      order.optionType, order.strikePrice, order.transactionType, order.quantity,
      order.lots, order.orderPrice, 'PENDING'
    ).run();
  }
}

/**
 * 🚨 Fast-Track Emergency Dispatch Pipeline 🚨
 * Used strictly by the local-daemon's executeEmergencyMarketExit.
 * Forces MARKET execution and blasts all slices concurrently.
 */
export async function dispatchEmergencyMarketExit(env: any, order: OrderPayload, niftyLotSize: number): Promise<void> {
  // Force MARKET execution regardless of what was passed
  order.orderPrice = 0; 

  const MAX_NIFTY_FREEZE_QUANTITY = 1800;
  const maxLotsPerOrder = Math.floor(MAX_NIFTY_FREEZE_QUANTITY / niftyLotSize);

  if (order.lots > maxLotsPerOrder) {
    let remainingLots = order.lots;
    let sliceIndex = 1;
    const emergencyDispatchPromises = [];

    while (remainingLots > 0) {
      const sliceLots = Math.min(remainingLots, maxLotsPerOrder);
      
      const sliceOrder: OrderPayload = {
        ...order,
        orderId: crypto.randomUUID(),
        correlationId: `${order.correlationId}_EMERGENCY_s${sliceIndex}`,
        lots: sliceLots,
        quantity: sliceLots * niftyLotSize,
      };

      // Blast directly to highest priority queue type
      emergencyDispatchPromises.push(
        env.ORDER_QUEUE.send({
          type: 'DISPATCH_EMERGENCY_MARKET',
          correlationId: sliceOrder.correlationId,
          payload: { order: sliceOrder }
        })
      );

      remainingLots -= sliceLots;
      sliceIndex++;
    }
    
    // Concurrent execution of all slices - Zero delays
    await Promise.all(emergencyDispatchPromises);
    
  } else {
    await env.ORDER_QUEUE.send({
        type: 'DISPATCH_EMERGENCY_MARKET',
        correlationId: order.correlationId,
        payload: { order }
    });
  }
  
  // Ledger update is non-blocking to execution speed, record as EMERGENCY
  await env.TRADING_DB.prepare(
    `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    order.orderId || crypto.randomUUID(), order.correlationId, order.instrumentToken, order.tradingSymbol,
    order.optionType, order.strikePrice, order.transactionType, order.quantity,
    order.lots, 0, 'PENDING_EMERGENCY'
  ).run();
}
