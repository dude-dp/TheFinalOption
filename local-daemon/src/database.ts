// local-daemon/src/database.ts

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  logger.warn('[DB] Supabase credentials missing. Database logging is disabled.');
}

// Initialize direct PostgreSQL connection
export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 🚀 Pushes a completed 1-minute candle directly into PostgreSQL.
 * Uses upsert to gracefully handle any duplicate timestamps.
 */
export async function syncCandleToDatabase(candle: any, retries = 3): Promise<void> {
  if (!supabaseUrl) return;

  for (let i = 0; i < retries; i++) {
    try {
      const { error } = await supabase
        .from('nifty_candles')
        .upsert({
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        }, { onConflict: 'timestamp' });

      if (error) throw error;
      
      // Successfully logged!
      return; 
    } catch (error: any) {
      if (i === retries - 1) {
        logger.error(`[DB] Failed to sync live candle to Supabase after ${retries} attempts: ${error.message}`);
      }
      // Wait 1 second before retrying on network blip
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}
