// ============================================
// Serverless Logger — Writes to Supabase system_logs
// Fire-and-forget: never blocks the critical path
// ============================================

import type { Env } from './types';

async function writeLog(
  env: Env,
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  source = 'cf-worker'
): Promise<void> {
  // Always echo to CF Worker console (visible in wrangler tail / dashboard)
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : '✅';
  console.log(`[${level}] ${prefix} ${message}`);

  // Async write to Supabase — do not await, never throw
  try {
    fetch(`${env.SUPABASE_URL}/rest/v1/system_logs`, {
      method: 'POST',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify([{ level, message, source }])
    }).catch(() => { /* silently ignore network errors in the logger */ });
  } catch {
    // Fallback already done via console.log above
  }
}

export const logInfo  = (env: Env, msg: string, src?: string) => writeLog(env, 'INFO',  msg, src);
export const logWarn  = (env: Env, msg: string, src?: string) => writeLog(env, 'WARN',  msg, src);
export const logError = (env: Env, msg: string, src?: string) => writeLog(env, 'ERROR', msg, src);
