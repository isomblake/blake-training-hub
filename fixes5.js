const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');

c = c.replace(
`      // If session is from a prior day, leave it alone and create a fresh one for today
      if (best.date !== date) {
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

fs.writeFileSync('src/App.jsx', c);
console.log(!c.includes('create a fresh one for today') ? '✅ Date fix removed — returns existing session as-is' : '❌ Not applied');
