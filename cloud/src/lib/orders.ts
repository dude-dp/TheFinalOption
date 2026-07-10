import type { OrderPayload } from './types';
import { KV_KEYS } from './types';

export async function addPendingOrder(kv: KVNamespace, order: OrderPayload): Promise<void> {
  const raw = await kv.get(KV_KEYS.PENDING_ORDERS);
  const list: OrderPayload[] = raw ? JSON.parse(raw) : [];
  
  // Prevent duplicate additions of the same correlationId
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

export async function queueOrDispatchOrder(env: any, order: OrderPayload, niftyLotSize: number): Promise<void> {
  const MAX_NIFTY_FREEZE_QUANTITY = 1800;
  const maxLotsPerOrder = Math.floor(MAX_NIFTY_FREEZE_QUANTITY / niftyLotSize);

  if (order.lots > maxLotsPerOrder) {
    let remainingLots = order.lots;
    let sliceIndex = 1;

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
