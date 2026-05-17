// Export Meso 1 actual performance data for Meso 2 planning
// Usage: node export-meso1.js <SUPABASE_URL> <ANON_KEY>
const { createClient } = require('@supabase/supabase-js');

const url = process.env.REACT_APP_SUPABASE_URL || process.argv[2];
const key = process.env.REACT_APP_SUPABASE_ANON_KEY || process.argv[3];
if (!url || !key || url === 'YOUR_PROJECT_URL') {
  console.error('Usage: node export-meso1.js <SUPABASE_URL> <ANON_KEY>');
  process.exit(1);
}

const supabase = createClient(url, key);

// Meso 1 programmed starting weights (W1 base)
const PROGRAMMED = {
  // Upper A
  "Smith Flat Bench Press":      { wt: 120, sets: 3, reps: "8-10",   cat: "smith" },
  "Smith Incline Press":         { wt: 75,  sets: 3, reps: "10-12",  cat: "smith" },
  "Chin-Ups (Wide Overhand)":    { wt: null,sets: 3, reps: "6-10",   cat: "bw"    },
  "Seated Cable Row (Neutral)":  { wt: 140, sets: 3, reps: "10-12",  cat: "cable" },
  "Cable Lateral Raise":         { wt: 15,  sets: 3, reps: "12-15",  cat: "cable" },
  "Cable Face Pull (Rope)":      { wt: 70,  sets: 3, reps: "15-20",  cat: "cable" },
  "Cable EZ Bar Curl":           { wt: 65,  sets: 3, reps: "10-12",  cat: "cable" },
  "Cable OH Tricep Extension":   { wt: 60,  sets: 3, reps: "10-12",  cat: "cable" },
  // Lower A
  "Smith Front Squat":           { wt: 105, sets: 3, reps: "8-10",   cat: "smith" },
  "Smith Stiff-Leg Deadlift":    { wt: 115, sets: 3, reps: "8-10",   cat: "smith" },
  "Landmine Goblet Squat":       { wt: 30,  sets: 3, reps: "12-15",  cat: "iso"   },
  "Smith Deficit Calf Raise":    { wt: 115, sets: 3, reps: "12-15",  cat: "smith" },
  "Cable Crunch (Kneeling)":     { wt: 45,  sets: 3, reps: "12-15",  cat: "cable" },
  "Cable Upright Row":           { wt: 40,  sets: 2, reps: "12-15",  cat: "cable" },
  // Upper B
  "Smith Close-Grip Bench":      { wt: 75,  sets: 3, reps: "8-10",   cat: "smith" },
  "Cable Fly (Low-to-High)":     { wt: 15,  sets: 2, reps: "12-15",  cat: "cable" },
  "Cable Lat Pulldown (Close)":  { wt: 180, sets: 3, reps: "10-12",  cat: "cable" },
  "Landmine Row (Per Arm)":      { wt: 20,  sets: 3, reps: "10-12",  cat: "iso"   },
  "Cable Cross-Body Lateral":    { wt: 10,  sets: 3, reps: "15-20",  cat: "cable" },
  "Cable Rear Delt Fly":         { wt: 10,  sets: 3, reps: "15-20",  cat: "cable" },
  "Cable Bayesian Curl":         { wt: 20,  sets: 3, reps: "10-12",  cat: "cable" },
  "Cable Pushdown (Bar)":        { wt: 65,  sets: 3, reps: "10-12",  cat: "cable" },
  // Lower B (note: Smith Back Squat replaced Hack Squat at W4)
  "Smith Hack Squat (Feet Fwd)": { wt: 95,  sets: 3, reps: "10-12",  cat: "smith" },
  "Smith Back Squat":            { wt: 115, sets: 3, reps: "8-10",   cat: "smith" },
  "Smith Good Morning":          { wt: 75,  sets: 3, reps: "10-12",  cat: "smith" },
  "Smith Lunge (Front Elevated)":{ wt: 40,  sets: 2, reps: "12-15",  cat: "smith" },
  "Hanging Knee Raise":          { wt: null,sets: 3, reps: "12-15",  cat: "bw"    },
};

const WEEKS_PROG = [
  { label: "W1", rir: "4 RIR",   smith: 0,  cable: 0,   iso: 0   },
  { label: "W2", rir: "3 RIR",   smith: 5,  cable: 2.5, iso: 0   },
  { label: "W3", rir: "2 RIR",   smith: 5,  cable: 5,   iso: 2.5 },
  { label: "W4", rir: "2 RIR",   smith: 10, cable: 7.5, iso: 2.5 },
  { label: "W5", rir: "0-1 RIR", smith: 10, cable: 10,  iso: 5   },
];

async function run() {
  // 1. Fetch all Meso 1 sessions
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, date, notes, week_number, rir')
    .ilike('notes', 'Meso 1%')
    .order('date', { ascending: true });

  if (sErr) { console.error('Session fetch error:', sErr); process.exit(1); }
  if (!sessions || sessions.length === 0) {
    console.error('No Meso 1 sessions found');
    process.exit(1);
  }

  // 2. Fetch all exercises (id → name map)
  const { data: exercises } = await supabase
    .from('exercises')
    .select('id, name');
  const exMap = {};
  (exercises || []).forEach(e => { exMap[e.id] = e.name; });

  // 3. Fetch all sets for these sessions
  const sessionIds = sessions.map(s => s.id);
  const { data: sets, error: setErr } = await supabase
    .from('sets')
    .select('session_id, exercise_id, set_number, reps, weight, notes')
    .in('session_id', sessionIds)
    .order('set_number', { ascending: true });

  if (setErr) { console.error('Sets fetch error:', setErr); process.exit(1); }

  // 4. Index sets by session_id → exercise_name → set list
  const bySession = {};
  sessions.forEach(s => { bySession[s.id] = { meta: s, exercises: {} }; });
  (sets || []).forEach(set => {
    const sess = bySession[set.session_id];
    if (!sess) return;
    const exName = exMap[set.exercise_id] || `ex_${set.exercise_id}`;
    if (!sess.exercises[exName]) sess.exercises[exName] = [];
    sess.exercises[exName].push(set);
  });

  // 5. Build per-exercise progression table
  // exercise → week# → { sets, avgWt, avgReps, minWt, maxWt, rir }
  const exProgress = {};

  Object.values(bySession).forEach(({ meta, exercises: exMap2 }) => {
    const weekNum = meta.week_number;
    const weekLabel = weekNum ? `W${weekNum}` : 'W?';

    Object.entries(exMap2).forEach(([exName, setList]) => {
      if (!exProgress[exName]) exProgress[exName] = {};
      if (!exProgress[exName][weekLabel]) exProgress[exName][weekLabel] = { sessions: [] };

      const wts = setList.map(s => s.weight).filter(w => w != null && w > 0);
      const repsArr = setList.map(s => s.reps).filter(r => r != null);
      const avgWt = wts.length ? Math.round((wts.reduce((a, b) => a + b, 0) / wts.length) * 10) / 10 : null;
      const avgReps = repsArr.length ? Math.round((repsArr.reduce((a, b) => a + b, 0) / repsArr.length) * 10) / 10 : null;

      // Parse RIR from set notes (e.g. "rir:2")
      const rirNotes = setList.map(s => s.notes).filter(n => n && n.startsWith('rir:'));
      const lastRir = rirNotes.length ? rirNotes[rirNotes.length - 1].replace('rir:', '') : null;

      exProgress[exName][weekLabel].sessions.push({
        date: meta.date,
        routine: meta.notes,
        setCount: setList.length,
        avgWt,
        avgReps,
        minWt: wts.length ? Math.min(...wts) : null,
        maxWt: wts.length ? Math.max(...wts) : null,
        lastRir,
      });
    });
  });

  // 6. Print formatted output
  const lines = [];

  lines.push('═══════════════════════════════════════════════════════');
  lines.push('  MESO 1 PERFORMANCE EXPORT  (for Meso 2 planning)');
  lines.push(`  Generated: ${new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}`);
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  // Summary of sessions
  lines.push('SESSION LOG:');
  sessions.forEach(s => {
    const exCount = Object.keys(bySession[s.id].exercises).length;
    lines.push(`  ${s.date}  ${(s.notes||'').padEnd(35)}  W${s.week_number||'?'}  ${exCount} exercises`);
  });
  lines.push('');

  // Weekly progression totals
  const weeksSeen = [...new Set(sessions.map(s => s.week_number).filter(Boolean))].sort((a,b)=>a-b);
  lines.push(`WEEKS COMPLETED: ${weeksSeen.map(w => 'W'+w).join(', ')}`);
  lines.push('');

  // Per-routine breakdown
  const routineOrder = ['Upper A', 'Lower A', 'Upper B', 'Lower B'];
  const exercisesByRoutine = {
    'Upper A': ['Smith Flat Bench Press','Smith Incline Press','Chin-Ups (Wide Overhand)','Seated Cable Row (Neutral)','Cable Lateral Raise','Cable Face Pull (Rope)','Cable EZ Bar Curl','Cable OH Tricep Extension'],
    'Lower A': ['Smith Front Squat','Smith Stiff-Leg Deadlift','Landmine Goblet Squat','Smith Deficit Calf Raise','Cable Crunch (Kneeling)','Cable Upright Row'],
    'Upper B': ['Smith Close-Grip Bench','Cable Fly (Low-to-High)','Cable Lat Pulldown (Close)','Landmine Row (Per Arm)','Cable Cross-Body Lateral','Cable Rear Delt Fly','Cable Bayesian Curl','Cable Pushdown (Bar)'],
    'Lower B': ['Smith Hack Squat (Feet Fwd)','Smith Back Squat','Smith Good Morning','Smith Lunge (Front Elevated)','Smith Deficit Calf Raise','Hanging Knee Raise','Cable Upright Row'],
  };

  const colW = ['W1','W2','W3','W4','W5'];

  for (const routine of routineOrder) {
    lines.push(`──────────────────────────────────────────────────────`);
    lines.push(`  ${routine}`);
    lines.push(`──────────────────────────────────────────────────────`);

    const exNames = exercisesByRoutine[routine];
    for (const exName of exNames) {
      const prog = PROGRAMMED[exName];
      const data = exProgress[exName] || {};
      const anyData = colW.some(w => data[w]?.sessions?.length);
      if (!anyData && exName.includes('Hack Squat')) continue; // silently skip if replaced

      const progStr = prog ? `${prog.wt ?? 'BW'} lb  ${prog.sets}×${prog.reps}` : 'bodyweight';
      lines.push('');
      lines.push(`  ${exName}`);
      lines.push(`  Programmed: ${progStr} (${prog?.cat || '?'}) starting W1`);

      let hasAny = false;
      for (const wLabel of colW) {
        const wData = data[wLabel];
        if (!wData || !wData.sessions.length) continue;
        hasAny = true;
        // Combine multiple sessions in the same week (Upper A appears twice)
        const allSess = wData.sessions;
        const allWts = allSess.flatMap(s => s.avgWt != null ? [s.avgWt] : []);
        const allReps = allSess.flatMap(s => s.avgReps != null ? [s.avgReps] : []);
        const weekAvgWt = allWts.length ? Math.round(allWts.reduce((a,b)=>a+b,0)/allWts.length*10)/10 : null;
        const weekAvgReps = allReps.length ? Math.round(allReps.reduce((a,b)=>a+b,0)/allReps.length*10)/10 : null;

        // Show individual session if multiple in same week
        if (allSess.length > 1) {
          allSess.forEach(s => {
            const rirTag = s.lastRir != null ? ` · RIR:${s.lastRir}` : '';
            const wtStr = s.avgWt != null ? `${s.avgWt} lb avg` : 'BW';
            lines.push(`    ${wLabel} (${s.date}): ${wtStr}  ×${s.avgReps ?? '?'} avg  (${s.setCount} sets${rirTag})`);
          });
        } else {
          const s = allSess[0];
          const rirTag = s.lastRir != null ? ` · RIR:${s.lastRir}` : '';
          const wtStr = s.avgWt != null ? `${s.avgWt} lb avg` : 'BW';
          lines.push(`    ${wLabel} (${s.date}): ${wtStr}  ×${s.avgReps ?? '?'} avg  (${s.setCount} sets${rirTag})`);
        }

        // Show Meso 2 suggestion based on final week's data
        if (wLabel === `W${Math.max(...weeksSeen)}` && weekAvgWt) {
          const p = prog;
          if (p && p.cat !== 'bw') {
            // Increment for next meso: ~same pattern as W1 (conservative restart)
            // Suggestion: use final week's avg weight as W1 starting point for Meso 2
            const m2Start = weekAvgWt;
            lines.push(`    → Meso 2 suggested W1 start: ~${m2Start} lb`);
          }
        }
      }

      if (!hasAny) {
        lines.push('    (no logged data)');
      }
    }
    lines.push('');
  }

  // Body weight + notes section
  lines.push('──────────────────────────────────────────────────────');
  lines.push('  NOTES FOR MESO 2 DESIGN');
  lines.push('──────────────────────────────────────────────────────');
  lines.push('  Equipment: Smith Machine, Cable Station, Landmine attachment');
  lines.push('  Split: 4-day Upper/Lower (UA-LA-UB-LB)');
  lines.push('  Meso 1 dates: Apr 13 – May ~25, 2026');
  lines.push('  Substitution: Smith Hack Squat → Smith Back Squat at W4 (knee pain)');
  lines.push('  RIR scheme: W1=4, W2=3, W3=2, W4=2, W5=0-1, W6=Deload');
  lines.push('  Progression: Smith +5/+10, Cable compound +2.5/+7.5, Iso +0/+2.5/+5 lb/wk');
  lines.push('');

  const output = lines.join('\n');
  console.log(output);

  // Also write to file
  const { writeFileSync } = require('fs');
  writeFileSync('meso1-export.txt', output);
  console.error(`\n✓ Also written to meso1-export.txt`);
}

run().catch(e => { console.error(e); process.exit(1); });
