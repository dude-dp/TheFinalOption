// local-daemon/src/database.ts

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

// 🛡️ THE FIX: Only initialize the client if the keys actually exist!
export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

if (!supabase) {
  logger.warn('[DB] 🚨 Supabase credentials missing from .env. Database logging is temporarily disabled, but trading will continue.');
}

/**
 * 🚀 Pushes a completed 1-minute candle directly into PostgreSQL.
 */
export async function syncCandleToDatabase(candle: any, retries = 3): Promise<void> {
  if (!supabase) return; // Safely abort if the DB engine isn't wired up

  for (let i = 0; i < retries; i++) {
    try {
      const { error } = await supabase
        .from('nifty_candles')
        .upsert({
          timestamp: new Date(candle.timestamp).toISOString(),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume || 0
        }, { onConflict: 'timestamp' });

      if (error) throw error;
      return; 
    } catch (error: any) {
      if (i === retries - 1) {
        logger.error(`[DB] Failed to sync live candle to Supabase after ${retries} attempts: ${error.message}`);
      }
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}
