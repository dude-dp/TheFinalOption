// ============================================
// Async Fire-and-Forget Log Dispatcher
// ============================================
// Pushes structured events to the Cloudflare Worker
// logging endpoint WITHOUT blocking the tick loop.
//
// The Worker then batch-inserts into Supabase
// system_events / trade_signals tables.
//
// CRITICAL: Never await these calls inside tick handlers.
// ============================================

import { logWarn } from './logger.js';

export type AsyncLogType =
  | 'signal_eval'
  | 'slippage_event'
  | 'trade_fill'
  | 'gtt_placed'
  | 'circuit_breaker'
  | 'system_event';

export interface AsyncLogPayload {
  type: AsyncLogType;
  [key: string]: unknown;
}

const CLOUD_LOG_ENDPOINT = process.env.CLOUD_WORKER_URL
  ? `${process.env.CLOUD_WORKER_URL}/api/log`
  : null;

const POLL_SECRET = process.env.POLL_SECRET ?? '';

/**
 * Fire-and-forget log dispatcher.
 *
 * Sends a structured event payload to the Cloudflare Worker logging endpoint.
 * The Promise is intentionally NOT awaited — a failed push is logged locally
 * as a warning but never throws, ensuring zero impact on the execution path.
 *
 * Usage inside tick handlers:
 *   asyncLog({ type: 'signal_eval', signal: 'BUY_CE', vwap: 24500, rsi: 61 });
 *   // No await — continues immediately
 */
export function asyncLog(payload: AsyncLogPayload): void {
  if (!CLOUD_LOG_ENDPOINT) {
    // Silently skip if endpoint not configured (dev/test environment)
    return;
  }

  const body = JSON.stringify({
    ...payload,
    timestamp: new Date().toISOString(),
  });

  // Intentionally un-awaited
  fetch(CLOUD_LOG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Poll-Secret': POLL_SECRET,
    },
    body,
  }).catch((err: Error) => {
    logWarn(`[ASYNC-LOG] Push failed (non-critical): ${err.message}`);
  });
}
