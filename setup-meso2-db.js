// Paste into browser console on the app page to insert Meso 2 DB records
(async () => {
  const URL = 'https://bahpdsjlshwphqjdxusi.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhaHBkc2psc2h3cGhxamR4dXNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MjQyMTcsImV4cCI6MjA5MTAwMDIxN30.vFQFV2Kc6g8YNbvgNyzZeZEWRZ7gUTz2sLjipCyGijw';
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

  const post = (path, body) =>
    fetch(`${URL}/rest/v1/${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
      .then(r => r.json());

  // 1. Insert new exercises (ignore if already exists)
  const exercises = [
    { name: 'Cable Leg Extension', muscles: 'Quads', muscle_group: 'Quads', cable_ratio: 2, vid_url: 'https://www.youtube.com/watch?v=arEMtyU054g' },
    { name: 'DB Lateral Raise',    muscles: 'Side Delts', muscle_group: 'Side Delts', cable_ratio: 1 , vid_url: 'https://www.youtube.com/watch?v=4hTUCDUQaNA' },
    { name: 'DB Rear Delt Fly',    muscles: 'Rear Delts', muscle_group: 'Rear Delts', cable_ratio: 1, vid_url: 'https://www.youtube.com/shorts/LsT-bR_zxLo' },
    { name: 'Barbell RDL',         muscles: 'Hamstrings · Glutes', muscle_group: 'Hamstrings', cable_ratio: 1, vid_url: 'https://www.youtube.com/watch?v=_oyxCn2iSjU' },
  ];

  for (const ex of exercises) {
    // Check if already exists
    const existing = await fetch(`${URL}/rest/v1/exercises?name=eq.${encodeURIComponent(ex.name)}&select=id`, { headers: H }).then(r => r.json());
    if (existing.length > 0) {
      console.log(`✓ Already exists: ${ex.name}`);
    } else {
      const res = await post('exercises', ex);
      console.log(`✓ Inserted exercise: ${ex.name}`, res);
    }
  }

  // 2. Insert Meso 2 mesocycle row
  const existing = await fetch(`${URL}/rest/v1/mesocycles?name=eq.RP%20Hypertrophy%20Meso%202&select=id`, { headers: H }).then(r => r.json());
  if (existing.length > 0) {
    console.log('✓ Meso 2 mesocycle already exists:', existing[0].id);
  } else {
    const meso = await post('mesocycles', {
      name: 'RP Hypertrophy Meso 2',
      start_date: '2026-05-26',
      end_date: '2026-07-05',
      status: 'planned',
    });
    console.log('✓ Inserted mesocycle:', meso);
  }

  console.log('Done. Meso 2 DB setup complete.');
})();
