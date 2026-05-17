// Paste this entire block into your browser console while on the app page.
// It will download meso1-full.csv with actual per-set RIR for W5.

(async () => {
  const URL = 'https://bahpdsjlshwphqjdxusi.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhaHBkc2psc2h3cGhxamR4dXNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MjQyMTcsImV4cCI6MjA5MTAwMDIxN30.vFQFV2Kc6g8YNbvgNyzZeZEWRZ7gUTz2sLjipCyGijw';
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  const get = (path) => fetch(`${URL}/rest/v1/${path}`, { headers: H }).then(r => r.json());

  const sessions = await get('sessions?select=id,date,notes,week_number&date=gte.2026-04-13&date=lte.2026-05-24&order=date');
  const ids = sessions.map(s => s.id);
  const sessMap = Object.fromEntries(sessions.map(s => [s.id, s]));

  const exercises = await get('exercises?select=id,name');
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));

  // Fetch sets in batches (URL length limit)
  const chunkSize = 20;
  let allSets = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const sets = await get(`sets?select=session_id,exercise_id,set_number,reps,weight,notes&session_id=in.(${chunk.join(',')})&order=set_number`);
    allSets = allSets.concat(sets);
  }

  const parseNotes = (notes) => {
    const r = { band: '', rir: '' };
    if (!notes) return r;
    notes.split('|').forEach(p => {
      if (p.startsWith('band:')) r.band = p.slice(5);
      else if (p.startsWith('rir:')) r.rir = p.slice(4);
    });
    return r;
  };

  const rows = ['date,session,week,exercise,set,reps,weight,band,rir_actual'];
  let withRir = 0;
  for (const st of allSets) {
    const s = sessMap[st.session_id];
    if (!s) continue;
    const ex = exMap[st.exercise_id] || '';
    const { band, rir } = parseNotes(st.notes);
    if (rir) withRir++;
    rows.push([s.date, `"${s.notes}"`, s.week_number, `"${ex}"`, st.set_number, st.reps, st.weight, band, rir].join(','));
  }

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'meso1-full.csv';
  a.click();
  console.log(`Done — ${rows.length - 1} sets, ${withRir} with actual RIR`);
})();
