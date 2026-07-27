import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://pwapzcnichfcmghnyxxo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function check() {
  const { data, error } = await supabase.from('mtf_instrument_master').select('liquidity_tier, is_active, mtf_bracket');
  if (error) {
    console.log(error);
    return;
  }
  let groups: Record<string, number> = {};
  data.forEach(d => {
    let key = `${d.liquidity_tier}_${d.is_active}`;
    groups[key] = (groups[key] || 0) + 1;
  });
  console.log("Groups:", groups);
}
check();
