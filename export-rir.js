// Export all Meso 1 sets with actual per-set RIR where available
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

// Parse "band:Green|rir:2" style notes into { band, rir }
function parseNotes(notes) {
  const result = { band: '', rir: '' };
  if (!notes) return result;
  notes.split('|').forEach(part => {
    if (part.startsWith('band:')) result.band = part.slice(5);
    else if (part.startsWith('rir:')) result.rir = part.slice(4);
  });
  return result;
}

async function run() {
  const { data: sessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id, date, notes, week_number')
    .gte('date', '2026-04-13')
    .lte('date', '2026-05-24')
    .order('date');

  if (sessErr) { console.error('Sessions error:', sessErr); process.exit(1); }

  const ids = sessions.map(s => s.id);
  const sessMap = Object.fromEntries(sessions.map(s => [s.id, s]));

  const { data: exercises } = await supabase.from('exercises').select('id, name');
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));

  const { data: sets, error: setsErr } = await supabase
    .from('sets')
    .select('session_id, exercise_id, set_number, reps, weight, notes')
    .in('session_id', ids)
    .order('session_id')
    .order('exercise_id')
    .order('set_number');

  if (setsErr) { console.error('Sets error:', setsErr); process.exit(1); }

  const rows = ['date,session,week,exercise,set,reps,weight,band,rir_actual'];
  let withRir = 0;

  for (const st of sets) {
    const s = sessMap[st.session_id];
    const ex = exMap[st.exercise_id] || '';
    const { band, rir } = parseNotes(st.notes);
    if (rir) withRir++;
    rows.push([
      s.date,
      `"${s.notes}"`,
      s.week_number,
      `"${ex}"`,
      st.set_number,
      st.reps,
      st.weight,
      band,
      rir
    ].join(','));
  }

  fs.writeFileSync('meso1-full.csv', rows.join('\n'));
  console.log(`Done — ${rows.length - 1} sets written to meso1-full.csv`);
  console.log(`  ${withRir} sets have actual RIR logged (rest show blank)`);
  console.log(`  Note: W1-W4 RIR was never saved to DB — only W5 sets have actual RIR`);
  console.log(`        (and only after the in-app migration ran on your device)`);
}

run().catch(e => { console.error(e); process.exit(1); });
