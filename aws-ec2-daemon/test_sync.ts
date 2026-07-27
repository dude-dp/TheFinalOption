import { syncUpstoxInstrumentMaster } from './src/lib/instrument-sync.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://pwapzcnichfcmghnyxxo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function test() {
  await syncUpstoxInstrumentMaster();
  const { count } = await supabase.from('mtf_instrument_master')
    .select('*', { count: 'exact' })
    .eq('liquidity_tier', 'HIGH')
    .eq('is_active', true);
  console.log("Count after sync (HIGH, active):", count);
}
test();
