import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabase } from '../database.js';
import { logInfo, logError, logWarn } from '../logger.js';

/**
 * Seeds the mtf_instrument_master table from the official AutoBot
 * Upstox MTF-enabled JSON (1,415 broker-verified stocks).
 * All are marked HIGH liquidity — Upstox pre-qualified them for margin.
 * The 15m screener further narrows to top F&O constituents via HIGH_PRIORITY_FNO.
 */
export async function syncUpstoxInstrumentMaster() {
  logInfo('[INSTRUMENT-SYNC] Seeding instrument master from AutoBot MTF JSON...');

  if (!supabase) {
    logWarn('[INSTRUMENT-SYNC] Supabase missing. Aborting sync.');
    return;
  }

  try {
    const jsonPath = resolve(process.cwd(), '../Upstox_MTF_enabled.json');
    const raw = readFileSync(jsonPath, 'utf-8');
    const mtfStocks: any[] = JSON.parse(raw);

    logInfo(`[INSTRUMENT-SYNC] Parsed ${mtfStocks.length} MTF-eligible stocks from AutoBot JSON.`);

    const instrumentsToSave = mtfStocks
      .filter(s => s.instrument_key && s.trading_symbol)
      .map(s => ({
        instrument_token: s.instrument_key,
        tradingsymbol:    s.trading_symbol,
        sector:           'EQUITY',
        liquidity_tier:   'HIGH',
        mtf_bracket:      s.mtf_bracket ?? 25.0,
        is_active:        true,
        updated_at:       new Date().toISOString()
      }));

    logInfo(`[INSTRUMENT-SYNC] Upserting ${instrumentsToSave.length} instruments to Supabase...`);

    const batchSize = 500;
    for (let i = 0; i < instrumentsToSave.length; i += batchSize) {
      const batch = instrumentsToSave.slice(i, i + batchSize);
      const { error } = await supabase.from('mtf_instrument_master').upsert(batch);
      if (error) throw error;
      logInfo(`[INSTRUMENT-SYNC] Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(instrumentsToSave.length / batchSize)} saved.`);
    }

    logInfo('[INSTRUMENT-SYNC] Instrument Master successfully seeded from AutoBot JSON!');
  } catch (error: any) {
    logError(`[INSTRUMENT-SYNC] Sync failed: ${error.message}`);
  }
}
