// Adds 2 missing Cable Upright Row sets (12 x 42.5) to Meso 1 W3D4
// Usage: node add-missing-sets.js <SUPABASE_URL> <ANON_KEY>
const { createClient } = require('@supabase/supabase-js');

const url = process.env.REACT_APP_SUPABASE_URL || process.argv[2];
const key = process.env.REACT_APP_SUPABASE_ANON_KEY || process.argv[3];
if (!url || !key || url === 'YOUR_PROJECT_URL') {
  console.error('Usage: node add-missing-sets.js <SUPABASE_URL> <ANON_KEY>');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  // Find the Meso 1 W3D4 session
  const { data: sessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id, date, notes, week_number')
    .eq('week_number', 3)
    .ilike('notes', 'Meso 1%')
    .ilike('notes', '%D4%')
    .order('date', { ascending: false })
    .limit(5);

  if (sessErr) { console.error('Session query error:', sessErr); process.exit(1); }
  if (!sessions || sessions.length === 0) { console.error('No Meso 1 W3D4 session found'); process.exit(1); }

  console.log('Found sessions:');
  sessions.forEach(s => console.log(' ', s.id, s.date, s.notes));

  const session = sessions[0];
  console.log('\nUsing session:', session.id, session.date, session.notes);

  // Find or create the Cable Upright Row exercise
  let { data: ex } = await supabase
    .from('exercises')
    .select('id')
    .eq('name', 'Cable Upright Row')
    .single();

  if (!ex) {
    const { data: created } = await supabase
      .from('exercises')
      .insert({ name: 'Cable Upright Row', cable_ratio: 2, muscle_group: 'Side Delts' })
      .select('id')
      .single();
    ex = created;
    console.log('Created exercise:', ex.id);
  } else {
    console.log('Found exercise:', ex.id);
  }

  // Find the highest existing set_number for this exercise in this session
  const { data: existingSets } = await supabase
    .from('sets')
    .select('set_number')
    .eq('session_id', session.id)
    .eq('exercise_id', ex.id)
    .order('set_number', { ascending: false });

  const maxSet = existingSets && existingSets.length > 0 ? existingSets[0].set_number : 0;
  console.log('Existing sets for Cable Upright Row:', maxSet);

  const setsToInsert = [
    { session_id: session.id, exercise_id: ex.id, set_number: maxSet + 1, reps: 12, weight: 42.5, notes: 'rir:2' },
    { session_id: session.id, exercise_id: ex.id, set_number: maxSet + 2, reps: 12, weight: 42.5, notes: 'rir:2' },
  ];

  const { data: inserted, error: insErr } = await supabase
    .from('sets')
    .insert(setsToInsert)
    .select();

  if (insErr) { console.error('Insert error:', insErr); process.exit(1); }
  console.log('\n✓ Inserted', inserted.length, 'sets:');
  inserted.forEach(s => console.log(`  Set ${s.set_number}: 12 x 42.5 lb (rir:2)`));
}

run().catch(e => { console.error(e); process.exit(1); });
