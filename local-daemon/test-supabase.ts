import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Retrieve values directly from your local environment configuration
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

console.log('Connecting to Supabase URL:', supabaseUrl);
if (!supabaseKey) {
  console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing from environment!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log('Attempting to write a sample row to historical_candles...');

  // Create a clean mock row matching the SQL schema
  const sampleRow = {
    timestamp_instrument: `TEST_${Date.now()}_NIFTY`,
    open: 24000.0,
    high: 24050.0,
    low: 23980.0,
    close: 24020.0,
    volume: 1000
  };

  const { data, error } = await supabase
    .from('historical_candles')
    .insert([sampleRow])
    .select();

  if (error) {
    console.error('❌ Insertion Failed!');
    console.error('Error Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
    console.error('Hint:', error.hint);
  } else {
    console.log('✅ Success! Data written to Supabase successfully.');
    console.log('Returned payload:', data);
  }
}

runTest();
