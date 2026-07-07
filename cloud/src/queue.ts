// ============================================
// Queue Consumer
// Processes async order status tracking messages
// ============================================

import type { Env, OrderQueueMessage } from './lib/types';

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
      }

      msg.ack();
    } catch (error) {
      msg.retry();
    }
  }
}
