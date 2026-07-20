import 'dotenv/config';

async function run() {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
    }
  });
  const spec = await res.json();
  console.log("system_state properties:", spec.definitions?.system_state?.properties);
}

run();
