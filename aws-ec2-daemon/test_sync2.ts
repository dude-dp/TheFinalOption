import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://pwapzcnichfcmghnyxxo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function syncUpstoxInstrumentMaster() {
    const jsonPath = resolve(process.cwd(), '../Upstox_MTF_enabled.json');
    const raw = readFileSync(jsonPath, 'utf-8');
    const mtfStocks = JSON.parse(raw);

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

    console.log(`Upserting ${instrumentsToSave.length} instruments to Supabase...`);

    const batchSize = 500;
    for (let i = 0; i < instrumentsToSave.length; i += batchSize) {
      const batch = instrumentsToSave.slice(i, i + batchSize);
      const { error } = await supabase.from('mtf_instrument_master').upsert(batch);
      if (error) console.error(error);
      console.log(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(instrumentsToSave.length / batchSize)} saved.`);
    }
}
syncUpstoxInstrumentMaster().then(() => console.log("Done"));
