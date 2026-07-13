// ============================================
// Local File Logger
// Daily rotating log files for daemon activity
// ============================================

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = process.env.LOG_DIR || './logs';

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(): string {
  return join(LOG_DIR, `daemon.log`);
}

function formatMessage(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${message}\n`;
}

export function logInfo(message: string): void {
  const line = formatMessage('INFO', message);
  process.stdout.write(line);
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export function logWarn(message: string): void {
  const line = formatMessage('WARN', message);
  process.stdout.write(line);
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export function logError(message: string): void {
  const line = formatMessage('ERROR', message);
  process.stderr.write(line);
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export function logTrade(message: string): void {
  const line = formatMessage('TRADE', message);
  process.stdout.write(`\x1b[33m${line}\x1b[0m`); // Yellow
  try { appendFileSync(getLogFile(), line); } catch (_) {}
}

export const logger = {
  info: logInfo,
  warn: logWarn,
  error: logError,
  trade: logTrade
};
