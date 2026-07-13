import { createClient } from '@supabase/supabase-js';
import { logInfo, logError, logWarn } from './logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export class DataEngine {
  private static instrumentKey = encodeURIComponent('NSE_INDEX|Nifty 50');

  /**
   * 🟢 LIVE INGESTION: Writes a newly closed 1-minute candle directly to Supabase.
   */
  public static async recordLiveCandle(candle: { timestamp: string, open: number, high: number, low: number, close: number, volume: number }) {
    try {
      const { error } = await supabase.from('nifty_candles').upsert({
        timestamp_instrument: `${candle.timestamp}_NIFTY`,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      }, { onConflict: 'timestamp_instrument' });

      if (error) throw error;
      // Silently succeed for live data to keep logs clean
    } catch (err: any) {
      logError(`[DATA-ENGINE] Failed to record live candle to Supabase: ${err.message}`);
    }
  }

  /**
   * 🩹 AUTO-HEALER: Detects gaps between the last DB entry and now, and patches them.
   */
  public static async autoRecoverGaps(upstoxToken: string) {
    logInfo('[DATA-ENGINE] Initializing Auto-Healer to check for missing candle data...');
    
    try {
      // 1. Find the exact timestamp of the last recorded candle in Supabase
      const { data, error } = await supabase
        .from('nifty_candles')
        .select('timestamp_instrument')
        .order('timestamp_instrument', { ascending: false })
        .limit(1);

      if (error) throw error;

      let lastDate = new Date();
      lastDate.setDate(lastDate.getDate() - 3); // Default to checking the last 3 days if DB is completely empty

      if (data && data.length > 0) {
        // Extract the ISO string from the composite key (e.g., "2026-07-13T09:15:00+05:30_NIFTY")
        const lastTimestampStr = data[0].timestamp_instrument.split('_')[0];
        lastDate = new Date(lastTimestampStr);
        logInfo(`[DATA-ENGINE] Last recorded candle found at: ${lastTimestampStr}`);
      } else {
        logWarn('[DATA-ENGINE] DB is empty. Defaulting to a 3-day baseline backfill.');
      }

      // 2. Loop through all days from the last recorded date to TODAY
      const today = new Date();
      let currentDate = new Date(lastDate);

      while (currentDate <= today) {
        const dateStr = currentDate.toISOString().split('T')[0];
        // Only run sync for weekdays (Mon=1 to Fri=5)
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          await this.patchDay(dateStr, upstoxToken);
        }
        // Move to the next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      logInfo('[DATA-ENGINE] Auto-Heal complete. Database is synchronized.');
    } catch (err: any) {
      logError(`[DATA-ENGINE] Auto-Heal failed: ${err.message}`);
    }
  }

  /**
   * Helper: Fetches and upserts an entire day's worth of candles from Upstox
   */
  private static async patchDay(dateStr: string, token: string) {
    try {
      const url = `https://api.upstox.com/v2/historical-candle/${this.instrumentKey}/1minute/${dateStr}/${dateStr}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) return;

      const json = await res.json() as any;
      if (json.status !== 'success' || !json.data || !json.data.candles) return;

      const candles = json.data.candles.map((c: any[]) => ({
        timestamp_instrument: `${c[0]}_NIFTY`,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseInt(c[5], 10)
      }));

      if (candles.length === 0) return;

      const { error } = await supabase
        .from('nifty_candles')
        .upsert(candles.reverse(), { onConflict: 'timestamp_instrument', ignoreDuplicates: true });

      if (error) throw error;
      
      logInfo(`[DATA-ENGINE] 🩹 Successfully patched ${candles.length} candles for ${dateStr}`);
    } catch (err: any) {
      logError(`[DATA-ENGINE] Failed to patch date ${dateStr}: ${err.message}`);
    }
  }
}
