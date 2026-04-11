const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');

// Fix 6 REVISED - Don't mutate old session dates.
// Instead: if found session is from a different date, create a NEW session for today.
c = c.replace(
  `      // Upgrade legacy notes to new format
      if (!best.notes.includes('Meso')) {
        await supabase.from('sessions').update({ notes: routineKey }).eq('id', best.id);
      }
      // Strip the sets array we joined for the count
      delete best.sets;
      return best;`,
  `      // Upgrade legacy notes to new format
      if (!best.notes.includes('Meso')) {
        await supabase.from('sessions').update({ notes: routineKey }).eq('id', best.id);
      }
      // If found session is from a prior day, create a fresh one for today instead
      if (best.date !== date) {
        delete best.sets;
        const { data: newSession, error: newErr } = await supabase
          .from('sessions')
          .insert({ date, week_number: weekNum, rir, status: 'in_progress', notes: routineKey })
          .select().single();
        if (newErr) console.error('New session error:', newErr);
        return newSession;
      }
      // Strip the sets array we joined for the count
      delete best.sets;
      return best;`
);

// Fix auto-detect: filter to only sessions from the ACTIVE meso before advancing
c = c.replace(
  `  // Auto-detect next routine based on last completed session
  useEffect(() => {
    db.getRecentSessions(5).then(sessions => {
      const completed = sessions.filter(s => s.status === "completed" && s.notes);
      if (completed.length === 0) return;
      const last = completed[0];
      const routineOrder = ["Upper A", "Lower A", "Upper B", "Lower B"];
      const lastMatch = last.notes.match(/(Upper [AB]|Lower [AB])/);
      if (!lastMatch) return;
      const lastIdx = routineOrder.indexOf(lastMatch[1]);
      if (lastIdx === -1) return;
      const nextIdx = (lastIdx + 1) % routineOrder.length;
      const nextKey = routineOrder[nextIdx];
      const appIdx = activeRoutineKeys.indexOf(nextKey);
      if (appIdx !== -1 && appIdx !== routine) setRoutine(appIdx);
    }).catch(() => {});
  }, []);`,
  `  // Auto-detect next routine based on last completed session (current meso only)
  useEffect(() => {
    db.getRecentSessions(20).then(sessions => {
      const completed = sessions.filter(s =>
        s.status === "completed" && s.notes && s.notes.startsWith(activeMeso.shortName)
      );
      if (completed.length === 0) return;
      const last = completed[0];
      const routineOrder = ["Upper A", "Lower A", "Upper B", "Lower B"];
      const lastMatch = last.notes.match(/(Upper [AB]|Lower [AB])/);
      if (!lastMatch) return;
      const lastIdx = routineOrder.indexOf(lastMatch[1]);
      if (lastIdx === -1) return;
      const nextIdx = (lastIdx + 1) % routineOrder.length;
      const nextKey = routineOrder[nextIdx];
      const appIdx = activeRoutineKeys.indexOf(nextKey);
      if (appIdx !== -1 && appIdx !== routine) setRoutine(appIdx);
    }).catch(() => {});
  }, []);`
);

fs.writeFileSync('src/App.jsx', c);

const checks = [
  ['Date fix - creates new session for today', c.includes("If found session is from a prior day, create a fresh one")],
  ['Auto-detect - filters to active meso', c.includes("s.notes.startsWith(activeMeso.shortName)")],
  ['Auto-detect - fetches 20 sessions', c.includes("getRecentSessions(20)")],
];
checks.forEach(([n, p]) => console.log(p ? '✅' : '❌', n));
