#!/usr/bin/env python3
"""
patch_meso4.py — Meso 4 config + two small ExerciseCard mechanics.
Run from repo root:  python3 patch_meso4.py && CI=true npm run build
Every replace asserts count==1 so a drifted anchor fails loudly instead of silently.
"""
import re, sys

P = "src/App.jsx"
src = open(P, encoding="utf-8").read()
orig = src

def rep(old, new, label):
    global src
    n = src.count(old)
    assert n == 1, f"[{label}] expected 1 anchor, found {n}"
    src = src.replace(old, new)
    print(f"  ok  {label}")

# ---------------------------------------------------------------------------
# 1. MESO4_ROUTINES — inserted right before the deload-weeks comment
# ---------------------------------------------------------------------------
PRESS_NOTE = "Exhale through press · no Valsalva · W5 stop at 1 RIR (bar can pin)"
MESO4 = r'''
// ============================================================================
// MESO 4 — Aug 24 → Oct 11, 2026. 5 acc weeks; W4 D3/D4 shift past Bristol (Sep 17); deload Oct 1–4 + beach rest. 6 exercises per session, project MEVs enforced.
// One exercise per muscle on upper days (chest/back 5 sets @ 2:00/1:45 rest, delts/arms 3–4).
// addSets: {weekNumber: n} — extra sets added from that accumulation week onward.
// calibrationWeeks: [n,...] — restrict the to-failure calibration marker to those weeks.
// ============================================================================
const MESO4_ROUTINES = {
  "Upper A": {
    day: "D1", sections: [
      { name: "Chest", exercises: [
        { name: "Smith Flat Bench Press", muscles: "Chest", sets: 5, reps: "10-15", rest: 120, wt: 120,
          note: "''' + PRESS_NOTE + r'''",
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-bench-press.html", src: "M&S" },
      ]},
      { name: "Back", exercises: [
        { name: "Cable Lat Pulldown (Close)", muscles: "Lats", sets: 5, reps: "8-12", rest: 120, wt: 190,
          vid: "https://www.muscleandstrength.com/exercises/close-grip-pull-down.html", src: "M&S" },
      ]},
      { name: "Shoulders", exercises: [
        { name: "DB Lateral Raise", muscles: "Side Delts", sets: 3, reps: "15-20", rest: 60, wt: 10,
          addSets: { 3: 1 },
          vid: "https://www.youtube.com/watch?v=4hTUCDUQaNA", src: "YouTube" },
        { name: "Cable Face Pull (Rope)", muscles: "Rear Delts", sets: 4, reps: "15-20", rest: 60, wt: 72.5,
          vid: "https://www.muscleandstrength.com/exercises/cable-face-pull", src: "M&S" },
      ]},
      { name: "Arms", exercises: [
        { name: "Cable EZ Bar Curl", muscles: "Biceps", sets: 4, reps: "8-12", rest: 90, wt: 50,
          vid: "https://www.muscleandstrength.com/exercises/cable-curl.html", src: "M&S" },
        { name: "Cable OH Tricep Extension", muscles: "Triceps", sets: 3, reps: "10-15", rest: 90, wt: 45,
          calibration: true, addSets: { 3: 1 },
          vid: "https://www.muscleandstrength.com/exercises/standing-low-pulley-overhead-tricep-extension-(rope-extension).html", src: "M&S" },
      ]},
    ]
  },
  "Lower A": {
    day: "D2", sections: [
      { name: "Quads", exercises: [
        { name: "Smith Front Squat", muscles: "Quads · Glutes", sets: 3, reps: "8-10", rest: 150, wt: 135,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-front-squat.html", src: "M&S" },
        { name: "Leg Extension", muscles: "Quads", sets: 3, reps: "15-20", rest: 60, wt: 80,
          calibration: true, addSets: { 3: 1 },
          vid: "https://www.muscleandstrength.com/exercises/leg-extension.html", src: "M&S" },
      ]},
      { name: "Hamstrings", exercises: [
        { name: "Smith Stiff-Leg Deadlift", muscles: "Hams · Glutes", sets: 3, reps: "8-10", rest: 150, wt: 145,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-stiff-leg-deadlift.html", src: "M&S" },
      ]},
      { name: "Calves + Core + Delts", exercises: [
        { name: "Smith Deficit Calf Raise", muscles: "Calves", sets: 4, reps: "15-20", rest: 60, wt: 135,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-calf-raise.html", src: "M&S" },
        { name: "Cable Crunch (Kneeling)", muscles: "Abs", sets: 3, reps: "12-15", rest: 60, wt: 80,
          calibration: true, calibrationWeeks: [1],
          vid: "https://www.muscleandstrength.com/exercises/cable-crunch.html", src: "M&S" },
        { name: "Cable Upright Row", muscles: "Side Delts", sets: 3, reps: "15-20", rest: 60, wt: 47.5,
          note: "Wide grip · elbows lead · stop just below shoulder height",
          vid: "https://www.muscleandstrength.com/exercises/cable-upright-row.html", src: "M&S" },
      ]},
    ]
  },
  "Upper B": {
    day: "D3", sections: [
      { name: "Chest", exercises: [
        { name: "Smith Incline Press", muscles: "Upper Chest", sets: 5, reps: "10-15", rest: 120, wt: 80,
          note: "''' + PRESS_NOTE + r'''",
          vid: "https://www.muscleandstrength.com/exercises/incline-smith-machine-bench-press.html", src: "M&S" },
      ]},
      { name: "Back", exercises: [
        { name: "Seated Cable Row (Neutral)", muscles: "Upper Back · Lats", sets: 5, reps: "8-12", rest: 120, wt: 175,
          vid: "https://www.muscleandstrength.com/exercises/seated-row.html", src: "M&S" },
      ]},
      { name: "Shoulders", exercises: [
        { name: "Cable Cross-Body Lateral", muscles: "Side Delts", sets: 3, reps: "15-20", rest: 60, wt: 5,
          addSets: { 3: 1 },
          note: "Single arm, low pulley, arm across body · 3 sets per arm · M1 ceiling was 7.5×15 @0-1 RIR",
          vid: "https://www.muscleandstrength.com/exercises/one-arm-cable-lateral-raise.html", src: "M&S" },
        { name: "Cable Rear Delt Fly", muscles: "Rear Delts", sets: 4, reps: "15-20", rest: 60, wt: 2.5,
          note: "Rep-progression exercise — stack ~2.5 is the load (M1 ran 0–2.5 all meso). Flat weight is NOT a stall; build reps to 20, then try 5",
          vid: "https://www.muscleandstrength.com/exercises/standing-cable-flys.html", src: "M&S" },
      ]},
      { name: "Arms", exercises: [
        { name: "Cable Bayesian Curl", muscles: "Biceps", sets: 4, reps: "8-12", rest: 90, wt: 22.5,
          calibration: true,
          vid: "https://barbend.com/bayesian-curl/", src: "BarBend" },
        { name: "Cable Pushdown (Bar)", muscles: "Triceps", sets: 3, reps: "8-12", rest: 90, wt: 70,
          addSets: { 3: 1 },
          vid: "https://www.muscleandstrength.com/exercises/tricep-extension.html", src: "M&S" },
      ]},
    ]
  },
  "Lower B": {
    day: "D4", sections: [
      { name: "Quads", exercises: [
        { name: "Smith Back Squat", muscles: "Quads · Glutes", sets: 3, reps: "8-10", rest: 150, wt: 135,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-squat.html", src: "M&S" },
      ]},
      { name: "Calves", exercises: [
        // De-stacked from axial: calf raise between squat and RDL
        { name: "Smith Deficit Calf Raise", muscles: "Calves", sets: 4, reps: "15-20", rest: 60, wt: 135,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-calf-raise.html", src: "M&S" },
      ]},
      { name: "Hamstrings", exercises: [
        { name: "Barbell RDL", muscles: "Hamstrings · Glutes", sets: 3, reps: "8-10", rest: 150, wt: 115,
          vid: "https://www.youtube.com/watch?v=_oyxCn2iSjU", src: "YouTube" },
      ]},
      { name: "Glutes", exercises: [
        { name: "Smith Hip Thrust", muscles: "Glutes", sets: 3, reps: "8-12", rest: 120, wt: 130,
          addSets: { 3: 1 },
          vid: "https://www.muscleandstrength.com/exercises/barbell-hip-thrust.html", src: "M&S" },
      ]},
      { name: "Core + Delts", exercises: [
        { name: "Hanging Straight-Leg Raise", muscles: "Abs", sets: 3, reps: "8-15", rest: 60, wt: null, bodyweight: true,
          note: "Legs straight, no swing. Progress: reps → toes higher → 5 lb DB between feet at 3×15",
          vid: "https://www.muscleandstrength.com/exercises/hanging-leg-raise.html", src: "M&S" },
        { name: "Cable Upright Row", muscles: "Side Delts", sets: 3, reps: "15-20", rest: 60, wt: 47.5,
          note: "Wide grip · elbows lead · stop just below shoulder height",
          vid: "https://www.muscleandstrength.com/exercises/cable-upright-row.html", src: "M&S" },
      ]},
    ]
  },
};

'''
rep('// Deload only has 1 "week" — no progression\n',
    MESO4.lstrip("\n") + '// Deload only has 1 "week" — no progression\n',
    "insert MESO4_ROUTINES")

# ---------------------------------------------------------------------------
# 2. MESOCYCLES entry
# ---------------------------------------------------------------------------
rep('''    weeks: WEEKS,
    routines: MESO3_ROUTINES,
  },
];''',
'''    weeks: WEEKS,
    routines: MESO3_ROUTINES,
  },
  {
    id: "rp-meso-4",
    name: "RP Meso 4",
    shortName: "Meso 4",
    startDate: "2026-08-24",
    endDate: "2026-10-11",
    weeks: WEEKS,
    routines: MESO4_ROUTINES,
  },
];''', "MESOCYCLES entry")

# ---------------------------------------------------------------------------
# 3. ExerciseCard: addSets-aware totalSets + calibration active-week flag
#    `week` is 0-indexed inside ExerciseCard; addSets/calibrationWeeks are 1-indexed.
# ---------------------------------------------------------------------------
rep('''  const wkData = (weeksConfig || WEEKS)[week];
  const totalSets = wkData.deload ? 2 : ex.sets;
  const allDone = numDone >= totalSets;
''',
'''  const wkData = (weeksConfig || WEEKS)[week];
  const addedSets = (!wkData.deload && ex.addSets)
    ? Object.entries(ex.addSets).reduce((a, [w, n]) => a + (parseInt(w) <= week + 1 ? n : 0), 0)
    : 0;
  const totalSets = wkData.deload ? 2 : ex.sets + addedSets;
  const allDone = numDone >= totalSets;
  const calibrationActive = !!ex.calibration && !wkData.deload
    && (!ex.calibrationWeeks || ex.calibrationWeeks.includes(week + 1));
''', "totalSets + calibrationActive")

rep('''          {ex.calibration && (
            <div style={{ fontSize: 10, color: C.teal, padding: "3px 7px", background: C.teal + "11", borderRadius: 5, marginBottom: 8 }}>
              📊 Last set to actual failure — weekly RIR calibration set
            </div>
          )}''',
'''          {calibrationActive && (
            <div style={{ fontSize: 10, color: C.teal, padding: "3px 7px", background: C.teal + "11", borderRadius: 5, marginBottom: 8 }}>
              📊 Last set to actual failure — {ex.calibrationWeeks ? `W${ex.calibrationWeeks.join("/W")} ` : "weekly "}RIR calibration set
            </div>
          )}
          {addedSets > 0 && (
            <div style={{ fontSize: 10, color: C.grn, padding: "3px 7px", background: C.grn + "11", borderRadius: 5, marginBottom: 8 }}>
              ＋ {addedSets} set{addedSets > 1 ? "s" : ""} added from W{Object.keys(ex.addSets).map(Number).sort((a, b) => a - b)[0]} — {ex.sets} → {totalSets}
            </div>
          )}''', "calibration banner + addSets banner")

# ---------------------------------------------------------------------------
# 4. Auto-reduce fix: the to-failure calibration set must not drive next week's
#    load. saveSessionPerformance now also stores avg reps/wt EXCLUDING the last
#    set (avgRepsX/avgWtX). ExerciseCard uses those for calibration exercises
#    and ignores the last-set RIR (which is 0 by design on that set).
# ---------------------------------------------------------------------------
rep('''    const avgWt = setArr.reduce((a, s) => a + (parseFloat(s.wt) || 0), 0) / setArr.length;
    const avgReps = setArr.reduce((a, s) => a + (parseInt(s.reps) || 0), 0) / setArr.length;
    // Use last set's RIR — the only set performed under full accumulated fatigue
    const setsWithRir = setArr.filter(s => s.rir != null);
    const lastRir = setsWithRir.length > 0 ? setsWithRir[setsWithRir.length - 1].rir : null;
    perf[exName] = { avgWt, avgReps, weekNumber, rir, avgRir: lastRir };''',
'''    const avgWt = setArr.reduce((a, s) => a + (parseFloat(s.wt) || 0), 0) / setArr.length;
    const avgReps = setArr.reduce((a, s) => a + (parseInt(s.reps) || 0), 0) / setArr.length;
    // Excluding the last set — used for calibration exercises whose last set goes to failure
    const nonLast = setArr.length > 1 ? setArr.slice(0, -1) : setArr;
    const avgWtX = nonLast.reduce((a, s) => a + (parseFloat(s.wt) || 0), 0) / nonLast.length;
    const avgRepsX = nonLast.reduce((a, s) => a + (parseInt(s.reps) || 0), 0) / nonLast.length;
    // Use last set's RIR — the only set performed under full accumulated fatigue
    const setsWithRir = setArr.filter(s => s.rir != null);
    const lastRir = setsWithRir.length > 0 ? setsWithRir[setsWithRir.length - 1].rir : null;
    perf[exName] = { avgWt, avgReps, avgWtX, avgRepsX, weekNumber, rir, avgRir: lastRir };''',
    "saveSessionPerformance stores non-last averages")

rep('''    const last = perf[ex.name];
    if (!last || last.avgWt == null) return null;
    return computeAdjustment(last.avgWt, last.avgReps, last.weekNumber || 0, last.rir || "", last.avgRir ?? null);
  }, [ex.name, ex.wt, ex.reps, week, mesoPrefix, baseTarget, weeklyAdd, minStep, wkData.deload]);''',
'''    const last = perf[ex.name];
    if (!last || last.avgWt == null) return null;
    if (ex.calibration && last.avgWtX != null) {
      // Calibration exercise: judge progression on the non-failure sets, ignore the failure set's RIR
      return computeAdjustment(last.avgWtX, last.avgRepsX, last.weekNumber || 0, last.rir || "", null);
    }
    return computeAdjustment(last.avgWt, last.avgReps, last.weekNumber || 0, last.rir || "", last.avgRir ?? null);
  }, [ex.name, ex.wt, ex.reps, ex.calibration, week, mesoPrefix, baseTarget, weeklyAdd, minStep, wkData.deload]);''',
    "lsResult uses non-last averages for calibration exercises")

rep('''      if (!last || !last.sets || last.sets.length === 0) return;
      const avgWt = last.sets.reduce((a, s) => a + s.weight, 0) / last.sets.length;
      const avgReps = last.sets.reduce((a, s) => a + s.reps, 0) / last.sets.length;''',
'''      if (!last || !last.sets || last.sets.length === 0) return;
      const useSets = (ex.calibration && last.sets.length > 1) ? last.sets.slice(0, -1) : last.sets;
      const avgWt = useSets.reduce((a, s) => a + s.weight, 0) / useSets.length;
      const avgReps = useSets.reduce((a, s) => a + s.reps, 0) / useSets.length;''',
    "dbResult fallback excludes failure set for calibration exercises")

# ---------------------------------------------------------------------------
# 5. Meso selector: collapse older mesos. Default shows current + previous
#    (+ whichever is selected); a "‹" button expands the full list.
# ---------------------------------------------------------------------------
rep('''  const [mesoIdx, setMesoIdx] = useState(() => getActiveMeso(localDate()));
  const activeMeso = MESOCYCLES[mesoIdx];''',
'''  const [mesoIdx, setMesoIdx] = useState(() => getActiveMeso(localDate()));
  const [showAllMesos, setShowAllMesos] = useState(false);
  const activeMeso = MESOCYCLES[mesoIdx];''', "showAllMesos state")

rep('''        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {MESOCYCLES.map((m, i) => {
            if (m.hideInWorkout) return null;
            const isActive = i === mesoIdx;
            const isCurrent = i === getActiveMeso(localDate());
            return (''',
'''        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {(() => {
            const curIdx = getActiveMeso(localDate());
            const cutoff = Math.min(curIdx, mesoIdx) - 1;
            const hasHidden = MESOCYCLES.some((m, i) => !m.hideInWorkout && i < cutoff);
            if (!hasHidden) return null;
            return (
              <button onClick={() => setShowAllMesos(v => !v)}
                style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                {showAllMesos ? "\u203a" : "\u2039"}
              </button>
            );
          })()}
          {MESOCYCLES.map((m, i) => {
            if (m.hideInWorkout) return null;
            const curIdx = getActiveMeso(localDate());
            if (!showAllMesos && i < Math.min(curIdx, mesoIdx) - 1) return null;
            const isActive = i === mesoIdx;
            const isCurrent = i === curIdx;
            return (''', "meso strip collapse")

# ---------------------------------------------------------------------------
open(P, "w", encoding="utf-8").write(src)
print(f"\nPatched {P}: {len(orig):,} → {len(src):,} chars (+{len(src)-len(orig):,})")
