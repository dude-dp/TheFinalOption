// ============================================
// TheFinalOption — MTF Screener Daemon
// ============================================

import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

import { logInfo, logError } from './logger.js';
import './server.js'; // Starts your local logging dashboard
import { run30MinScreener, startMTFTriggerListener } from './mtf-screener.js';
import { startMorningBriefingCron } from './morning-briefing.js';

process.on('uncaughtException', (err) => logError(`[FATAL] Uncaught Exception: ${err.message}\n${err.stack}`));
process.on('unhandledRejection', (reason, promise) => logError(`[FATAL] Unhandled Rejection at: ${promise}, reason: ${reason}`));

async function bootstrapEngine() {
  logInfo('═══════════════════════════════════════════');
  logInfo('  TheFinalOption — MTF Screener Daemon     ');
  logInfo('═══════════════════════════════════════════');

  // 1. Start Morning Briefings & Listeners
  startMorningBriefingCron();
  startMTFTriggerListener();

  // 2. Initial Boot Scan (Runs 5 seconds after boot)
  setTimeout(() => {
    logInfo('[BOOT] Running initial MTF Screener scan...');
    run30MinScreener().catch(err => logError(`[MTF-SCREENER] Initial boot scan failed: ${err.message}`));
  }, 5000);

  // 3. The Core Screener Cron (Fires exactly on 15m/30m candles)
  setInterval(() => {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();
    
    // Offset minutes: 16, 31, 46, 01 during market hours (09:15 to 15:30)
    const isMarketHours = hour >= 9 && (hour < 15 || (hour === 15 && minute <= 35));
    const isOffsetMinute = minute === 16 || minute === 31 || minute === 46 || minute === 1;
    const isEODSweep = hour === 15 && minute === 35;

    if (isMarketHours && (isOffsetMinute || isEODSweep)) {
      run30MinScreener().catch(err => logError(`[MTF-SCREENER] Cron scan error: ${err.message}`));
    }
  }, 60000); // Checks every minute
}

bootstrapEngine().catch((err: any) => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
