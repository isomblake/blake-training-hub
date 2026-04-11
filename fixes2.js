const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');

c = c.replace(
`      if (best.date !== date) {
        await supabase.from('sessions').update({ date }).eq('id', best.id);
        best.date = date;
      }
      if (best.date !== date) {
        await supabase.from('sessions').update({ date }).eq('id', best.id);
        best.date = date;
      }
      // Strip the sets array we joined for the count
      delete best.sets;
      return best;`,
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
      return best;`
);

c = c.replace(
`      const completed = sessions.filter(s =>
        s.status === "completed" && s.notes && s.notes.startsWith(activeMeso.shortName)
      );
      if (completed.length === 0) return;
      const last = completed[0];
      const routineOrder = ["Upper A", "Lower A", "Upper B", "Lower B"];`,
`      const routineOrder = ["Upper A", "Lower A", "Upper B", "Lower B"];
      const completed = sessions.filter(s =>
        s.status === "completed" && s.notes && routineOrder.some(r => s.notes.includes(r))
      );
      if (completed.length === 0) return;
      const last = completed[0];`
);

fs.writeFileSync('src/App.jsx', c);

const checks = [
  ['Date fix', c.includes("leave it alone") || (c.includes("best.date !== date") && c.includes("insert({ date, week_number"))],
  ['Auto-detect fix', c.includes("routineOrder.some(r => s.notes.includes(r))")],
];
checks.forEach(([n, p]) => console.log(p ? '✅' : '❌', n));
