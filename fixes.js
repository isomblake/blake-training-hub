const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');

// Fix 1 - Notifications
c = c.replace(
`function scheduleTimerNotification(seconds, exName) {
  if (!_notifPermission || !("Notification" in window)) return null;
  const timeoutId = setTimeout(() => {
    try {
      new Notification("Rest Complete", {
        body: exName + " — time for next set",
        tag: "rest-timer",
        requireInteraction: true,
      });
    } catch(e) {}
  }, seconds * 1000);
  return timeoutId;
}

function cancelTimerNotification(timeoutId) {
  if (timeoutId) clearTimeout(timeoutId);
}`,
`function _sendNotif(title, body) {
  if (!_notifPermission || !("Notification" in window)) return;
  if (document.visibilityState !== 'hidden') return;
  try { new Notification(title, { body, tag: "rest-timer", requireInteraction: true }); } catch(e) {}
}
function scheduleTimerNotification(seconds, exName) {
  const ids = [];
  if (seconds > 10) ids.push(setTimeout(() => _sendNotif("⏱ 10 seconds left", exName + " — get ready"), (seconds - 10) * 1000));
  ids.push(setTimeout(() => _sendNotif("✅ Rest Complete", exName + " — time for next set"), seconds * 1000));
  return ids;
}
function cancelTimerNotification(ids) { (ids || []).forEach(id => clearTimeout(id)); }`
);

// Fix 2 - Meso bleed
c = c.replace(
  'if (mesoPrefix) { const filtered = (sessions||[]).filter(s => s.notes && s.notes.startsWith(mesoPrefix)); if (filtered.length > 0) sessions = filtered; }',
  'if (mesoPrefix) { sessions = (sessions||[]).filter(s => s.notes && s.notes.startsWith(mesoPrefix)); }'
);

// Fix 3 - BW flag
c = c.replace(
  '{ name: "Chin-Ups (Wide Overhand)", muscles: "Lats · Upper Back", sets: 3, reps: "6-10", rest: 150, wt: null,\n          bands:',
  '{ name: "Chin-Ups (Wide Overhand)", muscles: "Lats · Upper Back", sets: 3, reps: "6-10", rest: 150, wt: null, bodyweight: true,\n          bands:'
);
c = c.replace(
  '{ name: "Hanging Knee Raise", muscles: "Abs", sets: 3, reps: "12-15", rest: 60, wt: null,',
  '{ name: "Hanging Knee Raise", muscles: "Abs", sets: 3, reps: "12-15", rest: 60, wt: null, bodyweight: true,'
);
c = c.replace('isBW={!ex.wt && ex.wt !== 0}', 'isBW={!!ex.bodyweight}');

// Fix 4 - Visibility resume
c = c.replace(
  'function _stopKeepAlive() {',
`if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _ctx && _soundEnabled) {
      _ctx.resume().catch(() => {});
    }
  });
}

function _stopKeepAlive() {`
);

// Fix 5 - No rest after last set
c = c.replace(
  'function ExerciseCard({ ex, week, weeksConfig, sessionKey, allSets, setAllSets, onStartRest, onSave, onSync, onDeleteFromDb, mesoPrefix }) {',
  'function ExerciseCard({ ex, week, weeksConfig, sessionKey, allSets, setAllSets, onStartRest, onSave, onSync, onDeleteFromDb, mesoPrefix, isLastExercise }) {'
);
c = c.replace(
  '    // Always start rest timer after every set — you need rest before the next exercise too\n    onStartRest(wkData.deload ? Math.min(ex.rest, 75) : ex.rest, ex.name, setNum, totalSets);',
  '    const isLastSet = setNum >= totalSets;\n    if (!(isLastExercise && isLastSet)) {\n      onStartRest(wkData.deload ? Math.min(ex.rest, 75) : ex.rest, ex.name, setNum, totalSets);\n    }'
);
c = c.replace(
  `            {sec.exercises.map((ex, ei) => (
              <ExerciseCard key={ei} ex={ex} week={week} weeksConfig={activeWeeks} sessionKey={sessionKey} allSets={allSets} setAllSets={setAllSets} onStartRest={startRest} onSave={saveToStorage} onSync={syncToDb} onDeleteFromDb={deleteFromDb} mesoPrefix={activeMeso.shortName} />
            ))}`,
  `            {sec.exercises.map((ex, ei) => {
              const isLastSec = si === r.sections.length - 1;
              const isLastEx = isLastSec && ei === sec.exercises.length - 1;
              return <ExerciseCard key={ei} ex={ex} week={week} weeksConfig={activeWeeks} sessionKey={sessionKey} allSets={allSets} setAllSets={setAllSets} onStartRest={startRest} onSave={saveToStorage} onSync={syncToDb} onDeleteFromDb={deleteFromDb} mesoPrefix={activeMeso.shortName} isLastExercise={isLastEx} />;
            })}`
);

// Fix 6 - Date fix
c = c.replace(
  '      // Strip the sets array we joined for the count\n      delete best.sets;\n      return best;',
  `      if (best.date !== date) {
        await supabase.from('sessions').update({ date }).eq('id', best.id);
        best.date = date;
      }
      // Strip the sets array we joined for the count
      delete best.sets;
      return best;`
);

fs.writeFileSync('src/App.jsx', c);

const checks = [
  ['Fix 1 - visibility check', c.includes("visibilityState !== 'hidden'")],
  ['Fix 2 - strict meso filter', c.includes("sessions = (sessions||[]).filter(s => s.notes && s.notes.startsWith(mesoPrefix));")],
  ['Fix 3 - bodyweight flag', c.includes('bodyweight: true')],
  ['Fix 3 - isBW prop', c.includes('isBW={!!ex.bodyweight}')],
  ['Fix 4 - visibilitychange', c.includes("addEventListener('visibilitychange'")],
  ['Fix 5 - isLastExercise', c.includes('isLastExercise')],
  ['Fix 6 - date fix', c.includes('best.date !== date')],
];
checks.forEach(([n, p]) => console.log(p ? '✅' : '❌', n));
