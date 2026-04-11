const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');

// ============================================================
// FIX 1: Remove the date check that creates phantom sessions.
// Just return the best session regardless of its date.
// The session has the sets — that's what matters.
// ============================================================
c = c.replace(
`      if (best.date !== date) {
        delete best.sets;
        const { data: newSess } = await supabase
          .from('sessions')
          .insert({ date, week_number: weekNum, rir, status: 'in_progress', notes: routineKey })
          .select().single();
        return newSess;
      }
      // Strip the sets array we joined for the count
      delete best.sets;
      return best;`,
`      // Strip the sets array we joined for the count
      delete best.sets;
      return best;`
);

// ============================================================
// FIX 2: Add meso filter to candidates query so Meso 0 sessions
// don't get picked up when looking for Meso 1 sessions and vice versa.
// routineKey looks like "Meso 1-W1D1-Upper A" — filter by meso prefix.
// ============================================================
c = c.replace(
`    // Find ALL matching sessions across today + yesterday for this routine + week
    // Search both new format (Meso 0-W1D1-Upper A) and legacy (W1-Upper A)
    const { data: candidates } = await supabase
      .from('sessions')
      .select('*, sets(id)')
      .eq('week_number', weekNum)
      .ilike('notes', \`%\${routineSuffix}%\`);`,
`    // Find ALL matching sessions for this meso + routine + week
    const mesoPrefix2 = routineKey.match(/^(Meso \\d+)/)?.[1];
    let query = supabase
      .from('sessions')
      .select('*, sets(id)')
      .eq('week_number', weekNum)
      .ilike('notes', \`%\${routineSuffix}%\`);
    if (mesoPrefix2) query = query.ilike('notes', \`\${mesoPrefix2}%\`);
    const { data: candidates } = await query;`
);

fs.writeFileSync('src/App.jsx', c);

const checks = [
  ['Fix 1 - no phantom session creation', !c.includes("create a fresh one for today") && !c.includes("insert({ date, week_number: weekNum, rir, status: 'in_progress'")],
  ['Fix 2 - meso prefix filter on candidates', c.includes("mesoPrefix2") && c.includes("ilike('notes', `${mesoPrefix2}%`)")],
];
checks.forEach(([n, p]) => console.log(p ? '✅' : '❌', n));
