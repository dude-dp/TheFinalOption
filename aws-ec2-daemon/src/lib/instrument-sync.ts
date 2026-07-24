import zlib from 'node:zlib';
import { supabase } from '../database.js';
import { logInfo, logError, logWarn } from '../logger.js';

// High Liquidity F&O constituents & NIFTY 100 MTF equities
export const HIGH_LIQUIDITY_STOCKS = new Set([
  'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 
  'KOTAKBANK', 'LT', 'AXISBANK', 'HINDUNILVR', 'BAJFINANCE', 'BHARTIARTL',
  'MARUTI', 'TATAMOTORS', 'M&M', 'SUNPHARMA', 'ASIANPAINT', 'TITAN',
  'LTIM', 'WIPRO', 'TATASTEEL', 'INDUSINDBK', 'BAJAJFINSV', 'HCLTECH',
  'ULTRACEMCO', 'NTPC', 'POWERGRID', 'ONGC', 'COALINDIA', 'ADANIENT',
  'ADANIPORTS', 'GRASIM', 'HEROMOTOCO', 'EICHERMOT', 'JSWSTEEL', 'HINDALCO',
  'APOLLOHOSP', 'DIVISLAB', 'DRREDDY', 'CIPLA', 'BRITANNIA', 'NESTLEIND',
  'TATACONSUM', 'BPCL', 'BEL', 'HAL', 'REC', 'PFC', 'DLF', 'TRENT'
]);

export async function syncUpstoxInstrumentMaster() {
  logInfo('[INSTRUMENT-SYNC] 📥 Downloading latest NSE instrument master from Upstox...');

  if (!supabase) {
    logWarn('[INSTRUMENT-SYNC] 🚨 Supabase missing. Aborting instrument master sync.');
    return;
  }

  try {
    const response = await fetch('https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz');
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Unzip in memory
    const csvData = zlib.gunzipSync(buffer).toString('utf-8');
    const lines = csvData.split('\n');

    const instrumentsToSave: any[] = [];

    // Skip the header row (i = 1)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const row = line.split(',');
      if (row.length < 10) continue;

      const instrument_key = row[0];   // e.g., NSE_EQ|INE002A01018
      const tradingsymbol = row[2];    // e.g., RELIANCE
      const instrument_type = row[9];  // e.g., EQ

      if (instrument_type === 'EQ') {
        instrumentsToSave.push({
          instrument_token: instrument_key,
          tradingsymbol: tradingsymbol,
          liquidity_tier: HIGH_LIQUIDITY_STOCKS.has(tradingsymbol) ? 'HIGH' : 'LOW',
          is_active: true,
          updated_at: new Date().toISOString()
        });
      }
    }

    logInfo(`[INSTRUMENT-SYNC] 📦 Parsed ${instrumentsToSave.length} total equities. Upserting to Supabase...`);

    // Upsert in batches of 500 to prevent Supabase payload limits
    const batchSize = 500;
    for (let i = 0; i < instrumentsToSave.length; i += batchSize) {
      const batch = instrumentsToSave.slice(i, i + batchSize);
      const { error } = await supabase.from('mtf_instrument_master').upsert(batch);
      if (error) throw error;
    }

    logInfo('[INSTRUMENT-SYNC] ✅ Instrument Master successfully updated!');
  } catch (error: any) {
    logError(`[INSTRUMENT-SYNC] ❌ Sync failed: ${error.message}`);
  }
}
