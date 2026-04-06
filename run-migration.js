const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const url = process.env.REACT_APP_SUPABASE_URL || process.argv[2];
const key = process.env.REACT_APP_SUPABASE_ANON_KEY || process.argv[3];

if (!url || !key) {
  console.error('Usage: node run-migration.js <SUPABASE_URL> <ANON_KEY>');
  process.exit(1);
}

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrate-history.sql'), 'utf8');
  
  // Split into individual statements
  const statements = sql.split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));
  
  console.log(`Running ${statements.length} statements...`);
  
  // Use fetch to call the Supabase REST API
  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`
  };
  
  // Run via the PostgREST rpc endpoint
  for (let i = 0; i < statements.length; i += 20) {
    const batch = statements.slice(i, i + 20).join(';\n') + ';';
    const resp = await fetch(`${url}/rest/v1/rpc/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: batch })
    });
    
    if (i % 100 === 0) console.log(`Progress: ${i}/${statements.length}`);
  }
  console.log('Migration complete!');
}

run().catch(console.error);
