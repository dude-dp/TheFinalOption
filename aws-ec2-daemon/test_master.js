import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://pwapzcnichfcmghnyxxo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function check() {
  const { data, error, count } = await supabase.from('mtf_instrument_master').select('*', { count: 'exact' });
  console.log("Error:", error);
  console.log("Count in mtf_instrument_master:", count);
}
check();
