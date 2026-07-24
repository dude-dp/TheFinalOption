import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';


dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function run() {
  const { data } = await supabase.from('system_state').select('upstox_access_token').eq('id', 1).single();
  const token = data?.upstox_access_token;
  if (!token) return console.error('No token');
  
  // Hardcoded known token from UPSTOX. NSE_FO|61093 or just search.
  // We can just fetch Nifty 50 spot first to verify the API format
  const instrumentKey = 'NSE_FO|61093';
  console.log(`Fetching LTP for ${instrumentKey}...`);
  
  const res = await fetch(`https://api.upstox.com/v2/market-quote/ltp?instrument_key=${encodeURIComponent(instrumentKey)}`, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

run().catch(console.error);
