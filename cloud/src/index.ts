// ============================================
// TheFinalOption — Cloud Brain (MTF Only)
// ============================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './lib/types';
import apiRoutes from './routes/api';
import { MTFScreenerPage } from './routes/mtf-screener';
import { handleScheduled, takeConfigSnapshot } from './cron';
import { handleQueue } from './queue';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Default dashboard is now the MTF Screener
app.get('/', (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  return c.html(MTFScreenerPage());
});

app.get('/mtf-screener', (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  return c.html(MTFScreenerPage());
});

app.get('/favicon.ico', (c) => c.body(null, 204));
app.route('/', apiRoutes); // Mount API routes for Supabase/DB interactions

export default {
  fetch: app.fetch,

  // Cron: '30 18 * * *' = midnight IST config snapshot
  //       All other crons = MTF Screener producer
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '30 18 * * *') {
      ctx.waitUntil(takeConfigSnapshot(env));
    } else {
      ctx.waitUntil(handleScheduled(env));
    }
  },

  // Queue: CF delivers batches from mtf-screener-queue here
  async queue(batch: MessageBatch<import('./lib/types').MTFQueueMessage>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  }
};
