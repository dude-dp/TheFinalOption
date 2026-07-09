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
