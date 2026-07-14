import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

async function run() {
  const { data, error } = await supabase
    .from('system_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    console.error('Error fetching system_state:', error);
  } else {
    console.log('Columns in system_state:', Object.keys(data));
    console.log('Sample data:', data);
  }
}

run();
