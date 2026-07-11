// ============================================
// TheFinalOption — Main Entry Point
// Exports: fetch (HTTP) + scheduled (Cron) + queue
// ============================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './lib/types';
import apiRoutes from './routes/api';
import dashboardRoutes from './routes/dashboard';
import { handleScheduled, takeConfigSnapshot } from './cron';
import { handleQueue } from './queue';

const app = new Hono<{ Bindings: Env }>();

// --- Middleware ---
app.use('*', cors());

// --- Mount Routes ---
// Dashboard at root
app.route('/', dashboardRoutes);

// API routes
app.route('/', apiRoutes);

// --- Export Handler ---
export default {
  // HTTP requests via Hono
  fetch: app.fetch,

  // Cron trigger — fires every minute during market hours
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '30 18 * * *') {
      ctx.waitUntil(takeConfigSnapshot(env));
    } else {
      ctx.waitUntil(handleScheduled(env));
    }
  },

  // Queue consumer — async order processing
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleQueue(batch as MessageBatch<any>, env));
  },
};
