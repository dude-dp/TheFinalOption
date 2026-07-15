import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function run() {
  const { data: candles, error: candleError } = await supabase
    .from('nifty_candles')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(5);

  if (candleError) {
    console.error('Error fetching nifty_candles:', candleError);
  } else {
    console.log('Sample nifty_candles:', candles);
  }

  const { data: state, error: stateError } = await supabase
    .from('system_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (stateError) {
    console.error('Error fetching system_state:', stateError);
  } else {
    console.log('Sample system_state:', state);
  }
}

run();
