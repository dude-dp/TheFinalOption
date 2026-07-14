// ============================================
// Cloud-Connected Logger
// Dual-writes to local files and Supabase UI
// ============================================

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const LOG_DIR = process.env.LOG_DIR || './logs';

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(): string {
  return join(LOG_DIR, `daemon.log`);
}

// 🟢 Initialize Supabase Client for Remote UI Telemetry
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

// Fire-and-forget push to Supabase (Zero Latency Impact)
function pushToCloud(message: string) {
  if (!process.env.SUPABASE_URL) return;
  (async () => {
    try {
      await supabase.from('system_telemetry').insert([{
        log_message: message,
        bot_status: 'RUNNING', 
        signal_generated: 'NONE',
        nifty_spot: 0,
        macd_line: 0,
        prev_macd_line: 0
      }]);
    } catch (_) {} // Catch silently so it never crashes the daemon
  })();
}

function formatMessage(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${message}\n`;
}

export function logInfo(message: string): void {
  const line = formatMessage('INFO', message);
  process.stdout.write(line);
  pushToCloud(message); // 🟢 Broadcast to Dashboard
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export function logWarn(message: string): void {
  const line = formatMessage('WARN', message);
  process.stdout.write(line);
  pushToCloud(message); // 🟢 Broadcast to Dashboard
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export function logError(message: string): void {
  const line = formatMessage('ERROR', message);
  process.stderr.write(line);
  pushToCloud(`ERROR: ${message}`); // 🟢 Broadcast to Dashboard
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export function logTrade(message: string): void {
  const line = formatMessage('TRADE', message);
  process.stdout.write(`\x1b[33m${line}\x1b[0m`);
  pushToCloud(`TRADE: ${message}`); // 🟢 Broadcast to Dashboard
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export const logger = {
  info: logInfo,
  warn: logWarn,
  error: logError,
  trade: logTrade
};
