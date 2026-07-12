// ============================================
// Queue Consumer
// Processes async order status tracking messages
// ============================================

import type { Env, OrderQueueMessage } from './lib/types';
import { addPendingOrder } from './lib/orders';

export async function handleQueue(
  batch: MessageBatch<OrderQueueMessage>,
  env: Env
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { type, correlationId, payload } = msg.body;

      switch (type) {
        case 'ORDER_STATUS_CHECK':
          // Future: poll Upstox order status and update D1
          // For now, the local daemon handles this directly
          await env.TRADING_DB.prepare(
            `UPDATE order_ledger SET log_message = 'Queue processed' WHERE correlation_id = ?`
          ).bind(correlationId).run();
          break;

        case 'POSITION_CLOSE':
          // Future: handle async position close confirmations
          break;

        case 'DISPATCH_SLICED_ORDER':
          const order = payload.order as any;
          await addPendingOrder(env.TRADING_KV, order);
          await env.TRADING_DB.prepare(
            `INSERT INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            order.orderId, order.correlationId, order.instrumentToken, order.tradingSymbol,
            order.optionType, order.strikePrice, order.transactionType, order.quantity,
            order.lots, order.orderPrice, 'PENDING'
          ).run();
          break;

        case 'DISPATCH_EMERGENCY_MARKET': {
          const emergencyOrder = payload.order as any;
          await addPendingOrder(env.TRADING_KV, emergencyOrder);
          await env.TRADING_DB.prepare(
            `INSERT OR IGNORE INTO order_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, order_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            emergencyOrder.orderId || crypto.randomUUID(), emergencyOrder.correlationId, emergencyOrder.instrumentToken, emergencyOrder.tradingSymbol,
            emergencyOrder.optionType, emergencyOrder.strikePrice, emergencyOrder.transactionType, emergencyOrder.quantity,
            emergencyOrder.lots, 0, 'PENDING_EMERGENCY'
          ).run();
          break;
        }
      }

      msg.ack();
    } catch (error) {
      msg.retry();
    }
  }
}
