import { logInfo } from '../logger.js';

let lastLogTime = 0;

/**
 * Checks if the given timestamp or current time is in the pre-market period.
 * NSE pre-market session runs from 09:00 AM to 09:08 AM IST, and regular session opens at 09:15 AM IST.
 * 09:15 AM IST corresponds to 03:45 AM UTC.
 */
export function isPreMarket(timestamp: number | Date = Date.now()): boolean {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();

  // 9:15 AM IST is 03:45 AM UTC
  // Any tick between 00:00 UTC and 03:44:59 UTC is pre-market
  if (utcHours < 3 || (utcHours === 3 && utcMinutes < 45)) {
    const now = Date.now();
    if (now - lastLogTime > 30000) {
      logInfo('[WAIT] Ignoring pre-market data before 09:15 AM IST (03:45 UTC)...');
      lastLogTime = now;
    }
    return true;
  }
  return false;
}
