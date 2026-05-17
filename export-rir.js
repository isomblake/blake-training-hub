// Export per-set RIR feedback for all Meso 1 sessions
// Usage: node export-rir.js   (reads .env.local automatically)
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length && !process.env[k]) process.env[k] = v.join('=');
  });
}

const url = process.env.REACT_APP_SUPABASE_URL || process.argv[2];
const key = process.env.REACT_APP_SUPABASE_ANON_KEY || process.argv[3];
if (!url || !key || url.includes('your-project')) {
  console.error('No credentials. Add .env.local or pass URL and key as args.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, date, notes, week_number')
    .gte('date', '2026-04-13')
    .lte('date', '2026-05-16')
    .order('date');

  const ids = sessions.map(s => s.id);
  const sessMap = Object.fromEntries(sessions.map(s => [s.id, s]));

  const { data: exercises } = await supabase.from('exercises').select('id, name');
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));

  const { data: sets } = await supabase
    .from('sets')
    .select('session_id, exercise_id, set_number, reps, weight, notes')
    .in('session_id', ids)
    .order('set_number');

  const rows = ['date,session,week,exercise,set,reps,weight,rir_notes'];
  for (const st of sets) {
    const s = sessMap[st.session_id];
    const ex = exMap[st.exercise_id] || '';
    rows.push([
      s.date, `"${s.notes}"`, s.week_number,
      `"${ex}"`, st.set_number, st.reps, st.weight,
      `"${st.notes || ''}"`
    ].join(','));
  }

  fs.writeFileSync('meso1-rir.csv', rows.join('\n'));
  console.log(`Done — ${rows.length - 1} sets written to meso1-rir.csv`);
}

run().catch(e => { console.error(e); process.exit(1); });
