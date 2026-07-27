import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://pwapzcnichfcmghnyxxo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function check() {
  const { data, error } = await supabase.from('mtf_screened_stocks').select('*');
  console.log("Error:", error);
  console.log("Count in screened_stocks:", data ? data.length : 0);
  if (data && data.length > 0) {
      console.log("Sample:", data[0]);
  }
}
check();
