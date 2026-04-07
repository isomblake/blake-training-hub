import React, { useState, useEffect, useCallback, useRef } from "react";

// === SOUND SYSTEM ===
// iPhone: AudioContext is the ONLY way to play sounds without killing Spotify.
// HTML Audio elements take over the iOS audio session and stop other apps.
// AudioContext oscillators mix with Spotify because they use the "ambient" category.
//
// Flow: user taps "Enable Sound" -> we resume AudioContext (requires gesture) ->
// then oscillator-based sounds play alongside Spotify for the rest of the session.

let _ctx = null;
let _soundEnabled = false;

function _ensureCtx() {
  // Reuse existing context, or create new one
  if (_ctx && _ctx.state !== 'closed') {
    // If suspended (iOS background), resume it
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    return _ctx;
  }
  _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function enableSound() {
  try {
    const ctx = _ensureCtx();
    ctx.resume().then(() => {
      // Play confirmation tone
      _playOsc(660, 0.15, 0.4);
      setTimeout(() => _playOsc(880, 0.15, 0.4), 160);
    }).catch(() => {});
  } catch(e) {}
  _soundEnabled = true;
  return true;
}

function disableSound() {
  _soundEnabled = false;
  return false;
}

function _playOsc(freq, dur, vol) {
  try {
    const ctx = _ensureCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch(e) {}
}

function playWarningSound() {
  if (_soundEnabled) {
    // Re-resume context in case iOS suspended it in background
    if (_ctx && _ctx.state === 'suspended') _ctx.resume().catch(() => {});
    // Double high ding — louder and repeated so it cuts through
    setTimeout(() => { _playOsc(880, 0.35, 0.9); }, 50);
    setTimeout(() => { _playOsc(880, 0.35, 0.9); }, 400);
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function playRestBeep() {
  if (_soundEnabled) {
    // Re-resume context in case iOS suspended it in background
    if (_ctx && _ctx.state === 'suspended') _ctx.resume().catch(() => {});
    // Ascending three-note chime: C5, E5, G5
    setTimeout(() => { _playOsc(523, 0.3, 0.7); }, 50);
    setTimeout(() => { _playOsc(659, 0.3, 0.7); }, 250);
    setTimeout(() => { _playOsc(784, 0.35, 0.8); }, 450);
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
}
import { supabase } from "./supabaseClient";

// ============================================================
// DATABASE HELPERS
// ============================================================
const db = {
  // Create or find a session for today's routine
  async getOrCreateSession(date, routineKey, weekNum, rir) {
    // Extract routine suffix (Upper A, Lower B, etc.) from key for flexible matching
    // routineKey looks like "Meso 0-W1D1-Upper A" or legacy "W1-Upper A"
    const routineMatch = routineKey.match(/(Upper [AB]|Lower [AB])/);
    const routineSuffix = routineMatch ? routineMatch[1] : routineKey;

    // Match any session for this date + routine name + week_number
    const { data: existing } = await supabase
      .from('sessions')
      .select('*')
      .eq('date', date)
      .eq('week_number', weekNum)
      .ilike('notes', `%${routineSuffix}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      // Update notes to new format if it's the legacy format
      if (!existing[0].notes.includes('Meso')) {
        await supabase.from('sessions').update({ notes: routineKey }).eq('id', existing[0].id);
      }
      return existing[0];
    }

    // Create new session
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        date,
        week_number: weekNum,
        rir,
        status: 'in_progress',
        notes: routineKey
      })
      .select()
      .single();
    
    if (error) console.error('Session create error:', error);
    return data;
  },

  // Log a set to the database
  async logSet(sessionId, exerciseName, setNumber, reps, weight, band) {
    // Find exercise ID
    const { data: ex } = await supabase
      .from('exercises')
      .select('id')
      .eq('name', exerciseName)
      .single();

    if (!ex) {
      console.error('Exercise not found:', exerciseName);
      return null;
    }

    const notes = band && band !== 'None' ? `band:${band}` : null;

    // Upsert the set (update if exists, insert if not)
    const { data: existingSets } = await supabase
      .from('sets')
      .select('id')
      .eq('session_id', sessionId)
      .eq('exercise_id', ex.id)
      .eq('set_number', setNumber);

    if (existingSets && existingSets.length > 0) {
      const { data, error } = await supabase
        .from('sets')
        .update({ reps, weight, notes })
        .eq('id', existingSets[0].id)
        .select()
        .single();
      if (error) console.error('Set update error:', error);
      return data;
    } else {
      const { data, error } = await supabase
        .from('sets')
        .insert({
          session_id: sessionId,
          exercise_id: ex.id,
          set_number: setNumber,
          reps,
          weight,
          notes
        })
        .select()
        .single();
      if (error) console.error('Set insert error:', error);
      return data;
    }
  },

  // Delete a set
  async deleteSet(sessionId, exerciseName, setNumber) {
    const { data: ex } = await supabase
      .from('exercises')
      .select('id')
      .eq('name', exerciseName)
      .single();
    
    if (!ex) return;

    await supabase
      .from('sets')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', ex.id)
      .eq('set_number', setNumber);
  },

  // Load all sets for a session
  async loadSession(sessionId) {
    const { data, error } = await supabase
      .from('sets')
      .select('*, exercises(name)')
      .eq('session_id', sessionId);
    
    if (error) {
      console.error('Load session error:', error);
      return {};
    }

    // Convert to the allSets format: { "sessionKey|ExerciseName": { 1: {reps, wt}, 2: {reps, wt} } }
    const result = {};
    (data || []).forEach(s => {
      const exName = s.exercises?.name;
      if (!exName) return;
      // We'll use a placeholder key that gets resolved in the component
      if (!result[exName]) result[exName] = {};
      const setData = { reps: s.reps, wt: s.weight };
      if (s.notes && s.notes.startsWith('band:')) setData.band = s.notes.replace('band:', '');
      result[exName][s.set_number] = setData;
    });
    return result;
  },

  // Get recent sessions for history
  async getRecentSessions(limit = 200) {
    const { data } = await supabase
      .from('sessions')
      .select('*, sets(*, exercises(name, muscles, muscle_group))')
      .order('date', { ascending: false })
      .limit(limit);
    return data || [];
  },

  // Finish a session — mark as completed with duration
  async finishSession(sessionId, durationMinutes) {
    const { data, error } = await supabase
      .from('sessions')
      .update({ status: 'completed', duration_minutes: durationMinutes })
      .eq('id', sessionId)
      .select()
      .single();
    if (error) console.error('Finish session error:', error);
    return data;
  },

  // Delete a session and all its sets
  async deleteSession(sessionId) {
    // Sets cascade on delete due to FK constraint
    await supabase.from('sets').delete().eq('session_id', sessionId);
    const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
    if (error) console.error('Delete session error:', error);
  },

  // Update an individual set by ID
  async updateSetById(setId, updates) {
    const { data, error } = await supabase
      .from('sets')
      .update(updates)
      .eq('id', setId)
      .select()
      .single();
    if (error) console.error('Update set error:', error);
    return data;
  },

  // Delete an individual set by ID
  async deleteSetById(setId) {
    const { error } = await supabase.from('sets').delete().eq('id', setId);
    if (error) console.error('Delete set error:', error);
  },

  // Update session details (duration, notes, etc.)
  async updateSession(sessionId, updates) {
    const { data, error } = await supabase
      .from('sessions')
      .update(updates)
      .eq('id', sessionId)
      .select()
      .single();
    if (error) console.error('Update session error:', error);
    return data;
  },

  // Get volume data for a week
  async getWeeklyVolume(startDate, endDate) {
    const { data } = await supabase
      .from('sessions')
      .select('*, sets(*, exercises(name, muscle_group))')
      .gte('date', startDate)
      .lte('date', endDate);
    
    // Aggregate by muscle group
    const volume = {};
    (data || []).forEach(session => {
      (session.sets || []).forEach(s => {
        const mg = s.exercises?.muscle_group;
        if (!mg) return;
        if (!volume[mg]) volume[mg] = { sets: 0, reps: 0, volume: 0 };
        volume[mg].sets += 1;
        volume[mg].reps += s.reps;
        volume[mg].volume += s.reps * s.weight;
      });
    });
    return volume;
  },

  // Get volume landmarks
  async getVolumeLandmarks() {
    const { data } = await supabase
      .from('volume_landmarks')
      .select('*');
    return data || [];
  },

  // Log body comp
  async logBodyComp(entry) {
    const { data, error } = await supabase
      .from('body_comp')
      .insert(entry)
      .select()
      .single();
    if (error) console.error('Body comp error:', error);
    return data;
  },

  // Get body comp history
  async getBodyCompHistory(limit = 30) {
    const { data } = await supabase
      .from('body_comp')
      .select('*')
      .order('date', { ascending: false })
      .limit(limit);
    return data || [];
  },

  // Get last session's data for an exercise (for auto-progression)
  async getLastSessionForExercise(exerciseName, beforeDate) {
    const { data: ex } = await supabase
      .from('exercises')
      .select('id')
      .eq('name', exerciseName)
      .single();
    if (!ex) return null;

    // Get recent sessions that have this exercise, before today
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, date, week_number, notes')
      .lt('date', beforeDate || '9999-12-31')
      .order('date', { ascending: false })
      .limit(10);

    if (!sessions || sessions.length === 0) return null;

    // For each recent session, check if it has sets for this exercise
    for (const session of sessions) {
      const { data: sets } = await supabase
        .from('sets')
        .select('reps, weight, set_number')
        .eq('session_id', session.id)
        .eq('exercise_id', ex.id);

      if (sets && sets.length > 0) {
        return { date: session.date, weekNumber: session.week_number, sets };
      }
    }
    return null;
  },

  // Get exercise progression (weight over time for a specific exercise)
  async getExerciseProgression(exerciseName) {
    const { data: ex } = await supabase
      .from('exercises')
      .select('id')
      .eq('name', exerciseName)
      .single();
    
    if (!ex) return [];

    const { data } = await supabase
      .from('sets')
      .select('reps, weight, set_number, created_at, sessions(date, week_number)')
      .eq('exercise_id', ex.id)
      .order('created_at', { ascending: true });
    
    return data || [];
  }
};

const C = {
  bg: "#06060b", card: "#0d0d15", c2: "#141420", bdr: "#1c1c2e",
  txt: "#e8e8f0", mut: "#6b6b80", grn: "#00e5a0", red: "#ff5c5c",
  gld: "#ffd166", blu: "#4ea8ff", pur: "#a78bfa", org: "#ff8c42", teal: "#00f2ea"
};

// Weight progression per week by equipment type:
// Smith (bar-loaded, 2.5 per side = 5 lb min jump): +0, +5, +5, +10, +10
// Cable compound (stack, 2.5 lb pin): +0, +2.5, +5, +7.5, +10
// Cable isolation (stack, slower): +0, +0, +2.5, +2.5, +5
const WEEKS = [
  { rir: "4 RIR", note: "Technique focus · moderate effort", smith: 0, cable: 0, iso: 0, deload: false },
  { rir: "3 RIR", note: "Effort up · weight up where possible", smith: 5, cable: 2.5, iso: 0, deload: false },
  { rir: "2 RIR", note: "Getting harder · hold reps stable", smith: 5, cable: 5, iso: 2.5, deload: false },
  { rir: "2 RIR", note: "Sustained effort · stay consistent", smith: 10, cable: 7.5, iso: 2.5, deload: false },
  { rir: "0-1 RIR", note: "PEAK · push near failure · max volume", smith: 10, cable: 10, iso: 5, deload: false },
  { rir: "4 RIR", note: "DELOAD · 50% weight · 50% sets · recover", smith: 0, cable: 0, iso: 0, deload: true },
];

// Determine exercise category from name for weight progression
function getExCategory(name, rest) {
  const isSmith = name.toLowerCase().startsWith("smith");
  const isCompound = rest >= 120;
  if (isSmith) return "smith";
  if (isCompound) return "cable"; // cable or landmine compound
  return "iso"; // cable/landmine isolation
}

// ============================================================
// MESOCYCLE DEFINITIONS
// Each mesocycle has its own routines, weeks config, and date range.
// The app auto-selects the active meso based on today's date,
// or the user can switch manually.
// ============================================================

// Helper: clone routines with overridden sets and weights for deload
function makeDeloadRoutines(baseRoutines, deloadWeights) {
  const result = {};
  Object.entries(baseRoutines).forEach(([key, routine]) => {
    result[key] = {
      ...routine,
      sections: routine.sections.map(sec => ({
        ...sec,
        exercises: sec.exercises.map(ex => {
          const dlWt = deloadWeights[ex.name];
          return { ...ex, sets: 2, wt: dlWt !== undefined ? dlWt : (ex.wt ? Math.round(ex.wt * 0.5 / 5) * 5 : null) };
        })
      }))
    };
  });
  return result;
}

// Base Meso 1 routines (used for both Meso 1 and pre-Meso deload)
const MESO1_ROUTINES = {
  "Upper A": {
    day: "Mon", cardio: "20-min incline walk", sections: [
      { name: "Chest", exercises: [
        { name: "Smith Flat Bench Press", muscles: "Chest", sets: 3, reps: "8-10", rest: 150, wt: 120,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-bench-press.html", src: "M&S" },
        { name: "Smith Incline Press", muscles: "Upper Chest", sets: 3, reps: "10-12", rest: 120, wt: 75,
          vid: "https://www.muscleandstrength.com/exercises/incline-smith-machine-bench-press.html", src: "M&S" },
      ]},
      { name: "Back", exercises: [
        { name: "Chin-Ups (Wide Overhand)", muscles: "Lats · Upper Back", sets: 3, reps: "6-10", rest: 150, wt: null,
          bands: ["Green", "Purple", "Black", "Red", "None"],
          vid: "https://www.muscleandstrength.com/exercises/wide-grip-pull-up.html", src: "M&S" },
        { name: "Seated Cable Row (Neutral)", muscles: "Upper Back · Lats", sets: 3, reps: "10-12", rest: 120, wt: 140,
          vid: "https://www.muscleandstrength.com/exercises/seated-row.html", src: "M&S" },
      ]},
      { name: "Shoulders", exercises: [
        { name: "Cable Lateral Raise", muscles: "Side Delts", sets: 3, reps: "12-15", rest: 60, wt: 15,
          vid: "https://www.muscleandstrength.com/exercises/two-arm-cable-lateral-raise.html", src: "M&S" },
        { name: "Cable Face Pull (Rope)", muscles: "Rear Delts", sets: 3, reps: "15-20", rest: 60, wt: 70,
          vid: "https://www.muscleandstrength.com/exercises/cable-face-pull", src: "M&S" },
      ]},
      { name: "Arms", exercises: [
        { name: "Cable EZ Bar Curl", muscles: "Biceps", sets: 3, reps: "10-12", rest: 90, wt: 65,
          vid: "https://www.muscleandstrength.com/exercises/cable-curl.html", src: "M&S" },
        { name: "Cable OH Tricep Extension", muscles: "Triceps", sets: 3, reps: "10-12", rest: 90, wt: 60,
          vid: "https://www.muscleandstrength.com/exercises/standing-low-pulley-overhead-tricep-extension-(rope-extension).html", src: "M&S" },
      ]},
    ]
  },
  "Lower A": {
    day: "Tue", cardio: "10-min incline walk", sections: [
      { name: "Quads", exercises: [
        { name: "Smith Front Squat", muscles: "Quads · Glutes", sets: 3, reps: "8-10", rest: 150, wt: 105,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-front-squat.html", src: "M&S" },
      ]},
      { name: "Hamstrings", exercises: [
        { name: "Smith Stiff-Leg Deadlift", muscles: "Hams · Glutes", sets: 3, reps: "8-10", rest: 150, wt: 115,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-stiff-leg-deadlift.html", src: "M&S" },
      ]},
      { name: "Quads (Volume)", exercises: [
        { name: "Landmine Goblet Squat", muscles: "Quads · Glutes", sets: 3, reps: "12-15", rest: 90, wt: 30,
          vid: "https://www.muscleandstrength.com/exercises/landmine-goblet-squat", src: "M&S" },
      ]},
      { name: "Calves + Core + Delts", exercises: [
        { name: "Smith Deficit Calf Raise", muscles: "Calves", sets: 3, reps: "12-15", rest: 60, wt: 115,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-calf-raise.html", src: "M&S" },
        { name: "Cable Crunch (Kneeling)", muscles: "Abs", sets: 3, reps: "12-15", rest: 60, wt: 45,
          vid: "https://www.muscleandstrength.com/exercises/cable-crunch.html", src: "M&S" },
        { name: "Cable Upright Row", muscles: "Side Delts", sets: 2, reps: "12-15", rest: 60, wt: 40,
          vid: "https://www.muscleandstrength.com/exercises/cable-upright-row.html", src: "M&S" },
      ]},
    ]
  },
  "Upper B": {
    day: "Thu", cardio: "20-min incline walk", sections: [
      { name: "Chest", exercises: [
        { name: "Smith Close-Grip Bench", muscles: "Chest · Triceps", sets: 3, reps: "8-10", rest: 150, wt: 75,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-close-grip-bench-press.html", src: "M&S" },
        { name: "Cable Fly (Low-to-High)", muscles: "Chest", sets: 2, reps: "12-15", rest: 90, wt: 15,
          vid: "https://www.muscleandstrength.com/exercises/cable-lower-chest-raise.html", src: "M&S" },
      ]},
      { name: "Back", exercises: [
        { name: "Cable Lat Pulldown (Close)", muscles: "Lats", sets: 3, reps: "10-12", rest: 120, wt: 180,
          vid: "https://www.muscleandstrength.com/exercises/close-grip-pull-down.html", src: "M&S" },
        { name: "Landmine Row (Per Arm)", muscles: "Upper Back · Lats", sets: 3, reps: "10-12", rest: 90, wt: 20,
          vid: "https://www.muscleandstrength.com/exercises/one-arm-bent-over-row.html", src: "M&S" },
      ]},
      { name: "Shoulders", exercises: [
        { name: "Cable Cross-Body Lateral", muscles: "Side Delts", sets: 3, reps: "15-20", rest: 60, wt: 10,
          vid: "https://www.muscleandstrength.com/exercises/one-arm-cable-lateral-raise.html", src: "M&S" },
        { name: "Cable Rear Delt Fly", muscles: "Rear Delts", sets: 3, reps: "15-20", rest: 60, wt: 10,
          vid: "https://www.muscleandstrength.com/exercises/standing-cable-flys.html", src: "M&S" },
      ]},
      { name: "Arms", exercises: [
        { name: "Cable Bayesian Curl", muscles: "Biceps", sets: 3, reps: "10-12", rest: 90, wt: 20,
          vid: "https://barbend.com/bayesian-curl/", src: "BarBend" },
        { name: "Cable Pushdown (Bar)", muscles: "Triceps", sets: 3, reps: "10-12", rest: 90, wt: 65,
          vid: "https://www.muscleandstrength.com/exercises/tricep-extension.html", src: "M&S" },
      ]},
    ]
  },
  "Lower B": {
    day: "Sat", cardio: "10-min incline walk", sections: [
      { name: "Quads", exercises: [
        { name: "Smith Hack Squat (Feet Fwd)", muscles: "Quads", sets: 3, reps: "10-12", rest: 120, wt: 95,
          vid: "https://www.muscleandstrength.com/exercises/feet-forward-smith-machine-squat.html", src: "M&S" },
      ]},
      { name: "Hamstrings", exercises: [
        { name: "Smith Good Morning", muscles: "Hams · Glutes", sets: 3, reps: "10-12", rest: 120, wt: 75,
          vid: "https://www.tiktok.com/@drmikeisraetel/video/7340302191909031211", src: "Dr. Mike" },
      ]},
      { name: "Glutes", exercises: [
        { name: "Smith Lunge (Front Elevated)", muscles: "Glutes · Quads", sets: 2, reps: "12-15", rest: 90, wt: 40,
          vid: "https://www.muscleandstrength.com/exercises/front-foot-elevated-smith-machine-split-squat", src: "M&S" },
      ]},
      { name: "Calves + Core + Delts", exercises: [
        { name: "Smith Deficit Calf Raise", muscles: "Calves", sets: 3, reps: "12-15", rest: 60, wt: 115,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-calf-raise.html", src: "M&S" },
        { name: "Hanging Knee Raise", muscles: "Abs", sets: 3, reps: "12-15", rest: 60, wt: null,
          vid: "https://www.muscleandstrength.com/exercises/hanging-knee-raise.html", src: "M&S" },
        { name: "Cable Upright Row", muscles: "Side Delts", sets: 2, reps: "12-15", rest: 60, wt: 40,
          vid: "https://www.muscleandstrength.com/exercises/cable-upright-row.html", src: "M&S" },
      ]},
    ]
  },
};

// Deload weights from master brief (50% of Meso 1 W1, rounded)
const DELOAD_WEIGHTS = {
  "Smith Flat Bench Press": 60, "Smith Incline Press": 40,
  "Chin-Ups (Wide Overhand)": null, "Seated Cable Row (Neutral)": 70,
  "Cable Lateral Raise": 10, "Cable Face Pull (Rope)": 35,
  "Cable EZ Bar Curl": 35, "Cable OH Tricep Extension": 30,
  "Smith Front Squat": 55, "Smith Stiff-Leg Deadlift": 60,
  "Landmine Goblet Squat": 15, "Smith Deficit Calf Raise": 60,
  "Cable Crunch (Kneeling)": 25, "Cable Upright Row": 20,
  "Smith Close-Grip Bench": 40, "Cable Fly (Low-to-High)": 10,
  "Cable Lat Pulldown (Close)": 90, "Landmine Row (Per Arm)": 10,
  "Cable Cross-Body Lateral": 5, "Cable Rear Delt Fly": 5,
  "Cable Bayesian Curl": 10, "Cable Pushdown (Bar)": 35,
  "Smith Hack Squat (Feet Fwd)": 50, "Smith Good Morning": 40,
  "Smith Lunge (Front Elevated)": 20, "Hanging Knee Raise": null,
};

const DELOAD_ROUTINES = makeDeloadRoutines(MESO1_ROUTINES, DELOAD_WEIGHTS);

// Deload only has 1 "week" — no progression
const DELOAD_WEEKS = [
  { rir: "4+ RIR", note: "DELOAD · 2 sets · 50% weight · learn Meso 1 moves · prep for Apr 13", smith: 0, cable: 0, iso: 0, deload: true },
];

// All mesocycles
// Sculpted Strength W9 deload uses Meso 1 exercises at 50% weight, 2 sets
const SCULPTED_DELOAD_WEEKS = [
  { rir: "4+ RIR", note: "W9 DELOAD · 2 sets · 50% weight · learn Meso 1 moves", smith: 0, cable: 0, iso: 0, deload: true, preDeloaded: true },
];

const MESOCYCLES = [
  {
    id: "sculpted-strength",
    name: "Sculpted Strength",
    shortName: "Meso 0",
    startDate: "2026-02-09",
    endDate: "2026-04-12",
    weeks: SCULPTED_DELOAD_WEEKS, // Only W9 deload is active in app (W1-W8 data is in history)
    routines: DELOAD_ROUTINES,
    note: "8 weeks completed (Feb 9 – Apr 4) · W9 Deload (Apr 6–12)",
  },
  {
    id: "rp-meso-1",
    name: "RP Meso 1",
    shortName: "Meso 1",
    startDate: "2026-04-13",
    endDate: "2026-05-24",
    weeks: WEEKS,
    routines: MESO1_ROUTINES,
  },
];

// Auto-select active mesocycle based on today's date
function getActiveMeso(dateStr) {
  for (let i = MESOCYCLES.length - 1; i >= 0; i--) {
    if (dateStr >= MESOCYCLES[i].startDate) return i;
  }
  return 0;
}

// Legacy compat — these get overridden in App based on active meso
let ROUTINES = MESO1_ROUTINES;
const ROUTINE_KEYS = Object.keys(MESO1_ROUTINES);

const fmtRest = s => s >= 60 ? `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}` : `${s}s`;
const fmtTimer = s => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

const BAND_COLORS = { Green: "#22c55e", Purple: "#a78bfa", Black: "#888", Red: "#ff5c5c", None: "#00e5a0" };

const SetRow = React.memo(function SetRow({ setNum, targetReps, targetWt, lastWeight, isBW, bands, onLog, onDelete, logged }) {
  // Local state ONLY used when actively editing or entering new data
  const initWt = lastWeight != null ? lastWeight.toString() : (targetWt?.toString() || (isBW ? "0" : ""));
  const [editReps, setEditReps] = useState(targetReps || "");
  const [editWt, setEditWt] = useState(initWt);
  const [band, setBand] = useState(bands ? bands[0] : null);
  const [editing, setEditing] = useState(false);
  const isDone = logged != null && !editing;

  // Display values: show logged data when done, local state when editing/entering
  const reps = isDone ? logged.reps.toString() : editReps;
  const wt = isDone ? logged.wt.toString() : editWt;

  // When entering edit mode, populate from logged data
  const startEdit = () => {
    if (logged) {
      setEditReps(logged.reps.toString());
      setEditWt(logged.wt.toString());
      if (logged.band) setBand(logged.band);
    }
    setEditing(true);
  };

  // When lastWeight changes from a previous set, update the input for unlogged sets
  useEffect(() => {
    if (!logged && !editing && lastWeight != null && !isBW) {
      setEditWt(lastWeight.toString());
    }
  }, [lastWeight]);

  const handleLog = () => {
    const weight = isBW ? 0 : parseFloat(editWt);
    if (editReps && (isBW || editWt)) {
      const data = { reps: parseInt(editReps), wt: weight };
      if (band) data.band = band;
      onLog(setNum, data);
      setEditing(false);
    }
  };

  const handleEdit = (e) => {
    e.stopPropagation();
    startEdit();
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete(setNum);
    setEditReps(targetReps || "");
    setEditWt(targetWt?.toString() || (isBW ? "0" : ""));
    setEditing(false);
  };

  const handleQuickLog = (e) => {
    e.stopPropagation();
    if (isDone) return;
    const r = editReps || targetReps;
    const w = isBW ? 0 : parseFloat(editWt || targetWt || 0);
    if (r && (isBW || w)) {
      const data = { reps: parseInt(r), wt: w };
      if (band) data.band = band;
      onLog(setNum, data);
      setEditing(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <div onClick={handleQuickLog} style={{ width: 28, height: 28, borderRadius: "50%", background: isDone ? C.grn : C.c2, border: `1px solid ${isDone ? C.grn : C.bdr}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: isDone ? C.bg : C.mut, cursor: "pointer", flexShrink: 0 }}>
        {isDone ? "✓" : setNum}
      </div>
      {isDone ? (
        <>
          <div style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: C.txt, flex: 1 }}>
            <span style={{ color: C.blu }}>{logged.reps}</span>
            <span style={{ color: C.mut }}> × </span>
            <span style={{ color: C.gld }}>{isBW ? "BW" : logged.wt}</span>
            {!isBW && <span style={{ color: C.mut, fontSize: 9 }}> lb</span>}
            {logged.band && <span style={{ fontSize: 9, color: BAND_COLORS[logged.band] || C.mut, marginLeft: 4, fontWeight: 600 }}>{logged.band} band</span>}
          </div>
          <button onClick={handleEdit} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.c2, color: C.mut, fontSize: 10, cursor: "pointer" }}>Edit</button>
          <button onClick={handleDelete} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.red}22`, background: C.red + "11", color: C.red, fontSize: 10, cursor: "pointer" }}>✕</button>
        </>
      ) : (
        <>
          <input type="number" inputMode="numeric" placeholder={targetReps} value={editReps} onChange={e => setEditReps(e.target.value)}
            onFocus={e => e.target.select()}
            style={{ width: 48, padding: "5px 4px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.c2, color: C.txt, fontSize: 13, textAlign: "center" }}
          />
          <span style={{ fontSize: 9, color: C.mut }}>reps</span>
          {isBW && <span style={{ fontSize: 12, color: C.teal, fontWeight: 600, marginLeft: 4 }}>BW</span>}
          {bands && (
            <select value={band || bands[0]} onChange={e => setBand(e.target.value)}
              style={{ padding: "4px 2px", borderRadius: 5, border: `1px solid ${BAND_COLORS[band] || C.bdr}44`, background: C.c2, color: BAND_COLORS[band] || C.txt, fontSize: 10, fontWeight: 600 }}>
              {bands.map(b => <option key={b} value={b}>{b === "None" ? "No band" : b}</option>)}
            </select>
          )}
          {!isBW && (
            <>
              <span style={{ fontSize: 12, color: C.mut }}>×</span>
              <input type="number" inputMode="decimal" placeholder={targetWt || "wt"} value={editWt} onChange={e => setEditWt(e.target.value)}
                onFocus={e => e.target.select()}
                style={{ width: 56, padding: "5px 4px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.c2, color: C.txt, fontSize: 13, textAlign: "center" }}
              />
              <span style={{ fontSize: 9, color: C.mut }}>lb</span>
            </>
          )}
          {editReps && (isBW || editWt) && (
            <button onClick={handleLog} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: C.grn, color: C.bg, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {editing ? "Save" : "Log"}
            </button>
          )}
          {editing && (
            <button onClick={() => setEditing(false)} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.c2, color: C.mut, fontSize: 10, cursor: "pointer" }}>Cancel</button>
          )}
        </>
      )}
    </div>
  );
}, (prev, next) => {
  // Only re-render if these specific values actually changed
  return prev.setNum === next.setNum
    && prev.targetWt === next.targetWt
    && prev.targetReps === next.targetReps
    && prev.isBW === next.isBW
    && prev.logged?.reps === next.logged?.reps
    && prev.logged?.wt === next.logged?.wt
    && prev.logged?.band === next.logged?.band
    && prev.lastWeight === next.lastWeight
    && (prev.logged == null) === (next.logged == null);
});

function RestTimer({ seconds, exName, setNum, totalSets, onDone }) {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const startTimeRef = useRef(Date.now());
  const ref = useRef(null);
  const warnedRef = useRef(false);
  const alertedRef = useRef(false);
  const touchStartY = useRef(null);

  useEffect(() => {
    // Use real timestamps so backgrounding doesn't break the timer
    ref.current = setInterval(() => {
      const realElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(realElapsed);
    }, 500); // Check every 500ms for faster catch-up after background
    return () => clearInterval(ref.current);
  }, []);

  // 10-second warning ding
  useEffect(() => {
    const remaining = seconds - elapsed;
    if (remaining <= 10 && remaining > 0 && !warnedRef.current) {
      warnedRef.current = true;
      playWarningSound();
    }
  }, [elapsed, seconds]);

  // Time's up chime
  useEffect(() => {
    if (elapsed >= seconds && !alertedRef.current) {
      alertedRef.current = true;
      playRestBeep();
    }
  }, [elapsed, seconds]);

  const remaining = Math.max(seconds - elapsed, 0);
  const isOver = elapsed >= seconds;
  const overBy = elapsed - seconds;
  const pct = Math.min(elapsed / seconds, 1);
  const accent = isOver ? C.grn : C.pur;

  // Swipe/drag handling
  const onTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (touchStartY.current === null) return;
    const diff = e.changedTouches[0].clientY - touchStartY.current;
    if (diff > 50) setExpanded(true);   // swipe down = expand
    if (diff < -50) setExpanded(false);  // swipe up = collapse
    touchStartY.current = null;
  };

  if (expanded) {
    // FULL SCREEN MODE
    return (
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        {/* Swipe hint */}
        <div onClick={() => setExpanded(false)}
          style={{ position: "absolute", top: 12, width: 40, height: 4, borderRadius: 2, background: C.mut + "44", cursor: "pointer" }} />

        <div style={{ fontSize: 12, color: C.mut, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Rest Timer</div>
        <div style={{ fontSize: 16, color: C.txt, fontWeight: 600, marginBottom: 20 }}>{exName}</div>

        {/* Big progress ring */}
        <div style={{ position: "relative", marginBottom: 20 }}>
          <svg width="200" height="200" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="100" cy="100" r="88" fill="none" stroke={C.bdr} strokeWidth="6" />
            <circle cx="100" cy="100" r="88" fill="none" stroke={accent} strokeWidth="6"
              strokeDasharray={`${pct * 553} 553`} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 64, fontWeight: 800, fontFamily: "monospace", color: isOver ? C.grn : C.txt, lineHeight: 1 }}>
              {isOver ? "+" + fmtTimer(overBy) : fmtTimer(remaining)}
            </div>
            <div style={{ fontSize: 12, color: isOver ? C.grn : C.mut, fontWeight: 600, marginTop: 4 }}>
              {isOver ? "GO — you're rested" : `${fmtTimer(elapsed)} / ${fmtRest(seconds)}`}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: C.mut, marginBottom: 24 }}>
          Set {setNum} of {totalSets} complete
          {setNum < totalSets && <span style={{ color: C.blu }}> — Set {setNum + 1} next</span>}
          {setNum >= totalSets && <span style={{ color: C.grn }}> — Exercise done!</span>}
        </div>

        <button onClick={() => { clearInterval(ref.current); onDone(); }}
          style={{ padding: "16px 60px", borderRadius: 14, border: "none", background: accent, color: C.bg, fontSize: 16, fontWeight: 800, cursor: "pointer" }}>
          {setNum < totalSets ? "Next Set →" : "Done ✓"}
        </button>
        <button onClick={() => setExpanded(false)}
          style={{ marginTop: 12, padding: "8px 20px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 11, cursor: "pointer" }}>
          Minimize
        </button>
      </div>
    );
  }

  // COMPACT BAR MODE
  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, background: isOver ? C.grn + "18" : C.card, borderBottom: `2px solid ${accent}`, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      {/* Swipe hint */}
      <div style={{ position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)", width: 30, height: 3, borderRadius: 2, background: C.mut + "44" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}
        onClick={() => setExpanded(true)}>
        <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "monospace", color: isOver ? C.grn : C.txt, lineHeight: 1, flexShrink: 0 }}>
          {isOver ? "+" + fmtTimer(overBy) : fmtTimer(remaining)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: isOver ? C.grn : C.txt, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {isOver ? "GO — you're rested" : exName}
          </div>
          <div style={{ fontSize: 9, color: C.mut }}>
            Set {setNum}/{totalSets} · {isOver ? "rest complete" : `${fmtTimer(elapsed)} / ${fmtRest(seconds)}`}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <svg width="32" height="32" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="16" cy="16" r="13" fill="none" stroke={C.bdr} strokeWidth="3" />
          <circle cx="16" cy="16" r="13" fill="none" stroke={accent} strokeWidth="3"
            strokeDasharray={`${pct * 81.7} 81.7`} strokeLinecap="round" />
        </svg>
        <button onClick={() => { clearInterval(ref.current); onDone(); }}
          style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: accent, color: C.bg, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          {isOver ? "Done ✓" : "Skip"}
        </button>
      </div>
    </div>
  );
}

function ExerciseCard({ ex, week, weeksConfig, sessionKey, allSets, setAllSets, onStartRest, onSave, onSync, onDeleteFromDb }) {
  const [expanded, setExpanded] = useState(false);
  const [smartTarget, setSmartTarget] = useState(null);
  const [progressNote, setProgressNote] = useState(null);
  const lastWeightRef = useRef(null);
  const exKey = `${sessionKey}|${ex.name}`;
  const logged = allSets[exKey] || {};
  const numDone = Object.keys(logged).length;
  const totalSets = ex.sets;
  const allDone = numDone >= totalSets;

  const wkData = (weeksConfig || WEEKS)[week];
  const exCat = getExCategory(ex.name, ex.rest);
  const weeklyAdd = wkData[exCat]; // smith, cable, or iso
  const minStep = exCat === "smith" ? 5 : 2.5; // rounding step
  const baseTarget = ex.wt
    ? wkData.deload
      ? (wkData.preDeloaded ? ex.wt : Math.round(ex.wt * 0.5 / minStep) * minStep)
      : Math.round((ex.wt + weeklyAdd) / minStep) * minStep
    : null;

  // Set Progression Algorithm: check last session's data and auto-adjust target
  useEffect(() => {
    if (!ex.wt || wkData.deload) return;
    setSmartTarget(null);
    setProgressNote(null);
    // Use tomorrow's date so we include today's earlier sessions too
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    db.getLastSessionForExercise(ex.name, tomorrow).then(last => {
      if (!last || !last.sets || last.sets.length === 0) return;
      const repRange = ex.reps.split("-").map(Number);
      const minReps = repRange[0];
      const maxReps = repRange[1] || repRange[0];
      const avgWt = last.sets.reduce((a, s) => a + s.weight, 0) / last.sets.length;
      const avgReps = last.sets.reduce((a, s) => a + s.reps, 0) / last.sets.length;
      const increment = minStep; // 5 for Smith, 2.5 for cable/iso
      const lastWk = last.weekNumber || 0;

      let adjusted = baseTarget;
      let note = null;

      // Only adjust if last data was from a PREVIOUS week (not current week being viewed)
      if (lastWk >= (week + 1)) return;

      if (avgReps >= maxReps && avgWt >= (baseTarget || 0)) {
        // Exceeded rep range at or above target — extra bump
        adjusted = Math.round((avgWt + increment) / minStep) * minStep;
        note = `↑ Bumped — hit ${Math.round(avgReps)} reps @ ${avgWt} lb last session (exceeded range)`;
      } else if (avgReps < minReps) {
        // Couldn't hit min reps — hold weight, don't progress
        adjusted = Math.round(avgWt / minStep) * minStep;
        note = `⏸ Holding @ ${avgWt} lb — only ${Math.round(avgReps)} reps last session (below ${minReps} min)`;
      } else if (avgWt > (baseTarget || 0)) {
        // Went heavier than programmed — adjust up from actual
        adjusted = Math.round((avgWt + increment) / minStep) * minStep;
        note = `↑ Adjusted — you lifted ${avgWt} lb last session (above programmed ${baseTarget})`;
      } else {
        // Normal progression — reps in range, weight on target
        return;
      }

      if (adjusted !== baseTarget) {
        setSmartTarget(adjusted);
        setProgressNote(note);
      }
    }).catch(() => {});
  }, [ex.name, week]);

  const targetWt = smartTarget || baseTarget;

  const logSet = (setNum, data) => {
    setAllSets(prev => {
      const prevEx = prev[exKey] || {};
      const updatedEx = { ...prevEx, [setNum]: data };
      // Cascade weight change to remaining UNLOGGED sets
      for (let s = setNum + 1; s <= totalSets; s++) {
        if (!prevEx[s]) {
          // Not logged yet — it'll pick up the new weight from the input default
          // Nothing to do in state, but we signal via a ref below
        }
      }
      return { ...prev, [exKey]: updatedEx };
    });
    // Store the latest weight so unlogged SetRows can pick it up
    if (data.wt !== undefined) lastWeightRef.current = data.wt;
    onSync(ex.name, setNum, data.reps, data.wt, data.band);
    // Always start rest timer after every set — you need rest before the next exercise too
    onStartRest(ex.rest, ex.name, setNum, totalSets);
  };

  const deleteSet = (setNum) => {
    setAllSets(prev => {
      const prevEx = { ...(prev[exKey] || {}) };
      delete prevEx[setNum];
      return { ...prev, [exKey]: prevEx };
    });
    if (onDeleteFromDb) onDeleteFromDb(ex.name, setNum);
  };

  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 12, marginBottom: 8, border: `1px solid ${allDone ? C.grn + "33" : C.bdr}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: allDone ? C.grn : C.txt }}>
              {expanded ? "▾" : "▸"} {ex.name} {allDone && <span style={{ fontSize: 10, color: C.grn }}>✓</span>}
            </div>
          </div>
          <div style={{ fontSize: 10, color: C.mut, marginTop: 1, marginLeft: 16 }}>{ex.muscles}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {!expanded && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700 }}>
                <span style={{ color: C.grn }}>{totalSets}</span>
                <span style={{ color: C.mut }}>×</span>
                <span style={{ color: C.blu }}>{ex.reps}</span>
                {targetWt && <span style={{ color: C.gld, marginLeft: 4 }}>@{targetWt}</span>}
              </div>
              <div style={{ fontSize: 9, color: C.mut }}>{numDone}/{totalSets} logged</div>
            </div>
          )}
          <a href={ex.vid} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
            style={{ display: "inline-flex", alignItems: "center", gap: 3, background: C.teal + "15", border: `1px solid ${C.teal}33`, borderRadius: 6, padding: "3px 7px", fontSize: 9, color: C.teal, textDecoration: "none", fontWeight: 600 }}>
            ▶ {ex.src}
          </a>
        </div>
      </div>

      {expanded && (
        <div onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 11, color: C.pur, padding: "5px 7px", background: C.pur + "11", borderRadius: 6, marginTop: 8, marginBottom: 8 }}>
            {wkData.rir} · {wkData.note}
          </div>
          
          <div style={{ display: "flex", gap: 12, marginBottom: 4, fontSize: 10 }}>
            <span style={{ color: C.mut }}>Target: <span style={{ color: C.grn, fontWeight: 600 }}>{totalSets}×{ex.reps}</span></span>
            <span style={{ color: C.mut }}>Rest: <span style={{ color: C.pur, fontWeight: 600 }}>{fmtRest(ex.rest)}</span></span>
            {targetWt && <span style={{ color: C.mut }}>Wt: <span style={{ color: smartTarget ? C.org : C.gld, fontWeight: 600 }}>{targetWt} lb{smartTarget ? " *" : ""}</span></span>}
          </div>
          {progressNote && (
            <div style={{ fontSize: 10, color: C.org, padding: "3px 7px", background: C.org + "11", borderRadius: 5, marginBottom: 8 }}>
              {progressNote}
            </div>
          )}

          {Array.from({ length: totalSets }, (_, i) => (
            <SetRow key={i} setNum={i + 1} targetReps={ex.reps.split("-")[0]} targetWt={targetWt} lastWeight={lastWeightRef.current} isBW={!ex.wt && ex.wt !== 0} bands={ex.bands} logged={logged[i + 1]} onLog={logSet} onDelete={deleteSet} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// HISTORY VIEW
// ============================================================
function HistoryView() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editFields, setEditFields] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [editingSetId, setEditingSetId] = useState(null);
  const [editSetFields, setEditSetFields] = useState({ reps: '', weight: '' });

  useEffect(() => {
    db.getRecentSessions(200).then(data => {
      // Filter to only sessions that have sets logged
      setSessions(data.filter(s => s.sets && s.sets.length > 0));
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: C.mut, fontSize: 12 }}>Loading history...</div>;
  if (sessions.length === 0) return <div style={{ padding: 40, textAlign: "center", color: C.mut, fontSize: 12 }}>No past workouts yet.</div>;

  // Group sets by exercise for a session
  const groupSets = (sets) => {
    const byExercise = {};
    (sets || []).forEach(s => {
      const name = s.exercises?.name || 'Unknown';
      if (!byExercise[name]) byExercise[name] = { name, muscles: s.exercises?.muscles || '', sets: [], firstTime: s.created_at };
      byExercise[name].sets.push(s);
      // Track earliest timestamp for ordering
      if (s.created_at < byExercise[name].firstTime) byExercise[name].firstTime = s.created_at;
    });
    // Sort sets within each exercise by set_number
    Object.values(byExercise).forEach(ex => ex.sets.sort((a, b) => a.set_number - b.set_number));
    // Sort exercises by the order they were performed (first set timestamp)
    return Object.values(byExercise).sort((a, b) => (a.firstTime || '').localeCompare(b.firstTime || ''));
  };

  // Parse routine into { name, detail } for display
  // Format: main line = program name, second line = Day Mon DD · W# / D#
  const getRoutineInfo = (notes, date) => {
    if (!notes) return { name: 'Workout', detail: '' };
    const dateStr = date ? fmtDate(date) : '';

    // New format: "Meso 0-W1D1-Upper A" or "Meso 1-W2D3-Upper B"
    const mesoMatch = notes.match(/^(Meso \d+)-W(\d+)D(\d)/);
    if (mesoMatch) return { name: mesoMatch[1], detail: `${dateStr} · W${mesoMatch[2]} / D${mesoMatch[3]}` };

    // Legacy: "W1-Upper A" (old format before meso tag)
    const legacyW = notes.match(/^W(\d+)-(Upper|Lower)\s+([AB])/);
    if (legacyW) {
      const dayMap = { "Upper A": 1, "Lower A": 2, "Upper B": 3, "Lower B": 4 };
      const d = dayMap[`${legacyW[2]} ${legacyW[3]}`] || 1;
      return { name: 'Meso 0', detail: `${dateStr} · W${legacyW[1]} / D${d}` };
    }

    // Sculpted Strength: "SC-W3D2 | Sculpted Strength | W3D2"
    const scMatch = notes.match(/SC-W(\d+)D(\d)/);
    if (scMatch) return { name: 'Sculpted Strength', detail: `${dateStr} · W${scMatch[1]} / D${scMatch[2]}` };

    // Starting Strength: "SS-W1D1 | Starting Strength | W1D1"
    const ssMatch = notes.match(/SS-W(\d+)D(\d)/);
    if (ssMatch) return { name: 'Starting Strength', detail: `${dateStr} · W${ssMatch[1]} / D${ssMatch[2]}` };

    // Natural Strength: "NS-W1D1"
    const nsMatch = notes.match(/NS-W(\d+)D(\d)/);
    if (nsMatch) return { name: 'Natural Strength', detail: `${dateStr} · W${nsMatch[1]} / D${nsMatch[2]}` };

    if (notes.includes('Natural')) return { name: 'Natural Strength', detail: dateStr };
    return { name: notes.split('|')[0]?.trim() || 'Workout', detail: dateStr };
  };

  const fmtDate = (d) => {
    const dt = new Date(d + 'T12:00:00');
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${days[dt.getDay()]} ${months[dt.getMonth()]} ${dt.getDate()}`;
  };

  return (
    <div>
      {sessions.map(session => {
        const isExpanded = expandedId === session.id;
        const exercises = groupSets(session.sets);
        const totalSets = session.sets?.length || 0;
        const { name: routineName, detail: routineDetail } = getRoutineInfo(session.notes, session.date);
        const totalVolume = (session.sets || []).reduce((a, s) => a + (s.reps * s.weight), 0);

        return (
          <div key={session.id} style={{ background: C.card, borderRadius: 10, marginBottom: 6, border: `1px solid ${C.bdr}`, overflow: "hidden" }}>
            {/* Session header — tap to expand */}
            <div onClick={() => setExpandedId(isExpanded ? null : session.id)}
              style={{ padding: "10px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>
                  {isExpanded ? "▾" : "▸"} {routineName}
                </div>
                <div style={{ fontSize: 10, color: C.mut, marginTop: 2, marginLeft: 16 }}>
                  {routineDetail || fmtDate(session.date)}
                  {session.duration_minutes ? <span> · {session.duration_minutes} min</span> : null}
                  {session.rir ? <span> · {session.rir}</span> : null}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.blu }}>{totalSets} sets</div>
                <div style={{ fontSize: 9, color: C.mut }}>{exercises.length} exercises</div>
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${C.bdr}` }}>
                {session.status === 'completed' && (
                  <div style={{ fontSize: 9, color: C.grn, padding: "6px 0 4px", fontWeight: 600 }}>✓ Completed</div>
                )}
                {exercises.map((ex, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>{ex.name}</div>
                    <div style={{ fontSize: 9, color: C.mut, marginBottom: 4 }}>{ex.muscles}</div>
                    {ex.sets.map((s, j) => {
                      const isEditingSet = editingSetId === s.id;
                      return (
                        <div key={s.id || j} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2, paddingLeft: 8 }}>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.grn + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: C.grn, flexShrink: 0 }}>
                            {s.set_number}
                          </div>
                          {isEditingSet ? (
                            <>
                              <input type="number" inputMode="numeric" value={editSetFields.reps}
                                onChange={e => setEditSetFields(f => ({...f, reps: e.target.value}))}
                                onFocus={e => e.target.select()}
                                style={{ width: 36, padding: "3px", borderRadius: 4, border: `1px solid ${C.bdr}`, background: C.c2, color: C.txt, fontSize: 11, textAlign: "center" }} />
                              <span style={{ color: C.mut, fontSize: 11 }}>×</span>
                              <input type="number" inputMode="decimal" value={editSetFields.weight}
                                onChange={e => setEditSetFields(f => ({...f, weight: e.target.value}))}
                                onFocus={e => e.target.select()}
                                style={{ width: 44, padding: "3px", borderRadius: 4, border: `1px solid ${C.bdr}`, background: C.c2, color: C.txt, fontSize: 11, textAlign: "center" }} />
                              <button onClick={async () => {
                                  const updates = { reps: parseInt(editSetFields.reps), weight: parseFloat(editSetFields.weight) };
                                  await db.updateSetById(s.id, updates);
                                  setSessions(prev => prev.map(sess => sess.id === session.id
                                    ? { ...sess, sets: sess.sets.map(x => x.id === s.id ? {...x, ...updates} : x) }
                                    : sess));
                                  setEditingSetId(null);
                                }}
                                style={{ padding: "2px 8px", borderRadius: 4, border: "none", background: C.grn, color: C.bg, fontSize: 9, fontWeight: 700, cursor: "pointer" }}>
                                ✓
                              </button>
                              <button onClick={() => setEditingSetId(null)}
                                style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 9, cursor: "pointer" }}>
                                ✕
                              </button>
                            </>
                          ) : (
                            <>
                              <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, flex: 1 }}>
                                <span style={{ color: C.blu }}>{s.reps}</span>
                                <span style={{ color: C.mut }}> × </span>
                                <span style={{ color: C.gld }}>{s.weight === 0 ? "BW" : s.weight}</span>
                                {s.weight > 0 && <span style={{ color: C.mut, fontSize: 9 }}> lb</span>}
                                {s.notes && s.notes.startsWith('band:') && (
                                  <span style={{ fontSize: 9, color: BAND_COLORS[s.notes.replace('band:','')] || C.mut, marginLeft: 4, fontWeight: 600 }}>
                                    {s.notes.replace('band:','')}
                                  </span>
                                )}
                              </div>
                              <button onClick={() => { setEditingSetId(s.id); setEditSetFields({ reps: s.reps.toString(), weight: s.weight.toString() }); }}
                                style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.bdr}`, background: C.c2, color: C.mut, fontSize: 9, cursor: "pointer" }}>
                                Edit
                              </button>
                              <button onClick={async () => {
                                  await db.deleteSetById(s.id);
                                  setSessions(prev => prev.map(sess => sess.id === session.id
                                    ? { ...sess, sets: sess.sets.filter(x => x.id !== s.id) }
                                    : sess));
                                }}
                                style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.red}33`, background: C.red + "11", color: C.red, fontSize: 9, cursor: "pointer" }}>
                                ✕
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {totalVolume > 0 && (
                  <div style={{ marginTop: 10, padding: "6px 8px", background: C.c2, borderRadius: 6, fontSize: 10, color: C.mut, display: "flex", justifyContent: "space-between" }}>
                    <span>Total volume: <span style={{ color: C.gld, fontWeight: 600 }}>{totalVolume.toLocaleString()} lb</span></span>
                    <span>{totalSets} sets across {exercises.length} exercises</span>
                  </div>
                )}

                {/* Edit session / Delete */}
                {editingId === session.id ? (
                  <div style={{ marginTop: 10, background: C.c2, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Edit Session</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: C.mut, width: 55 }}>Date:</span>
                        <input type="date" value={editFields.date || ''} onChange={e => setEditFields(f => ({...f, date: e.target.value}))}
                          style={{ flex: 1, padding: "4px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.card, color: C.txt, fontSize: 11 }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: C.mut, width: 55 }}>Duration:</span>
                        <input type="number" inputMode="numeric" value={editFields.duration || ''} onChange={e => setEditFields(f => ({...f, duration: e.target.value}))}
                          onFocus={e => e.target.select()}
                          style={{ width: 50, padding: "4px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.card, color: C.txt, fontSize: 11, textAlign: "center" }} />
                        <span style={{ fontSize: 10, color: C.mut }}>min</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: C.mut, width: 55 }}>Week:</span>
                        <input type="number" inputMode="numeric" value={editFields.week || ''} onChange={e => setEditFields(f => ({...f, week: e.target.value}))}
                          onFocus={e => e.target.select()}
                          style={{ width: 40, padding: "4px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.card, color: C.txt, fontSize: 11, textAlign: "center" }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: C.mut, width: 55 }}>RIR:</span>
                        <input type="text" value={editFields.rir || ''} onChange={e => setEditFields(f => ({...f, rir: e.target.value}))}
                          style={{ flex: 1, padding: "4px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.card, color: C.txt, fontSize: 11 }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: C.mut, width: 55 }}>Status:</span>
                        <select value={editFields.status || 'completed'} onChange={e => setEditFields(f => ({...f, status: e.target.value}))}
                          style={{ flex: 1, padding: "4px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.card, color: C.txt, fontSize: 11 }}>
                          <option value="completed">Completed</option>
                          <option value="in_progress">In Progress</option>
                          <option value="partial">Partial</option>
                          <option value="skipped">Skipped</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button onClick={async () => {
                          const updates = {};
                          if (editFields.date) updates.date = editFields.date;
                          if (editFields.duration) updates.duration_minutes = parseInt(editFields.duration);
                          if (editFields.week) updates.week_number = parseInt(editFields.week);
                          if (editFields.rir) updates.rir = editFields.rir;
                          if (editFields.status) updates.status = editFields.status;
                          await db.updateSession(session.id, updates);
                          setSessions(prev => prev.map(s => s.id === session.id ? { ...s, ...updates } : s));
                          setEditingId(null);
                        }}
                        style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: C.grn, color: C.bg, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 10, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                    <button onClick={() => {
                        setEditingId(session.id);
                        setEditFields({
                          date: session.date || '',
                          duration: session.duration_minutes?.toString() || '',
                          week: session.week_number?.toString() || '',
                          rir: session.rir || '',
                          status: session.status || 'completed',
                        });
                      }}
                      style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.c2, color: C.mut, fontSize: 10, cursor: "pointer" }}>
                      Edit Session
                    </button>
                    {confirmDeleteId === session.id ? (
                      <>
                        <span style={{ fontSize: 10, color: C.red, alignSelf: "center" }}>Delete?</span>
                        <button onClick={async () => {
                            await db.deleteSession(session.id);
                            setSessions(prev => prev.filter(s => s.id !== session.id));
                            setConfirmDeleteId(null);
                            setExpandedId(null);
                          }}
                          style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: C.red, color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                          Yes
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)}
                          style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 10, cursor: "pointer" }}>
                          No
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(session.id)}
                        style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.red}33`, background: C.red + "11", color: C.red, fontSize: 10, cursor: "pointer" }}>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [routine, setRoutine] = useState(() => {
    try {
      const saved = localStorage.getItem('training-hub-next-routine');
      if (saved != null) return parseInt(saved) || 0;
    } catch(e) {}
    return 0;
  });
  const [week, setWeek] = useState(0);
  const [allSets, setAllSets] = useState({});
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timer, setTimer] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [syncStatus, setSyncStatus] = useState("");
  const [dbConnected, setDbConnected] = useState(false);
  const [view, setView] = useState("workout"); // "workout" or "history"
  const [sessionStartTime] = useState(Date.now());
  const [showFinishReview, setShowFinishReview] = useState(false);
  const [mesoIdx, setMesoIdx] = useState(() => getActiveMeso(new Date().toISOString().slice(0, 10)));
  const activeMeso = MESOCYCLES[mesoIdx];
  const activeWeeks = activeMeso.weeks;
  const activeRoutines = activeMeso.routines;
  const [soundOn, setSoundOn] = useState(false);

  const activeRoutineKeys = Object.keys(activeRoutines);
  const r = activeRoutines[activeRoutineKeys[routine]];
  const rKey = activeRoutineKeys[routine];
  const today = new Date().toISOString().slice(0, 10);
  const sessionKey = today + "-" + rKey.replace(/\s+/g, "") + "-W" + (week + 1);

  // One-time: rename exercise with degree symbol so DB matches app
  useEffect(() => {
    supabase.from('exercises').update({ name: 'Smith Incline Press' }).eq('name', 'Smith Incline Press (30°)').then(() => {});
  }, []);

  // Load session from Supabase on mount or when routine/week changes
  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      try {
        setSyncStatus("loading...");
        // Include week number in session lookup so W1 and W2 are separate
        // Map routine to day number: Upper A=D1, Lower A=D2, Upper B=D3, Lower B=D4
        const dayMap = { "Upper A": 1, "Lower A": 2, "Upper B": 3, "Lower B": 4 };
        const dayNum = dayMap[rKey] || (activeRoutineKeys.indexOf(rKey) + 1);
        const weekTag = `${activeMeso.shortName}-W${week + 1}D${dayNum}-${rKey}`;
        const session = await db.getOrCreateSession(today, weekTag, week + 1, activeWeeks[week].rir);
        if (cancelled) return;

        if (session) {
          setCurrentSession(session);
          setDbConnected(true);
          const sessionSets = await db.loadSession(session.id);
          if (cancelled) return;

          // Convert to allSets format
          const rebuilt = {};
          Object.entries(sessionSets).forEach(([exName, sets]) => {
            rebuilt[`${sessionKey}|${exName}`] = sets;
          });
          setAllSets(rebuilt);
          const count = Object.values(sessionSets).reduce((s, ex) => s + Object.keys(ex).length, 0);
          setSyncStatus(count > 0 ? `restored ${count} sets` : "ready");
        } else {
          setSyncStatus("offline mode");
        }
      } catch (e) {
        console.error('Load error:', e);
        if (!cancelled) setSyncStatus("offline — using local");
      }
      if (!cancelled) setLoaded(true);
    };
    loadSession();
    return () => { cancelled = true; };
  }, [today, rKey, week, sessionKey]);

  // Sync a set to Supabase
  const syncToDb = useCallback(async (exercise, setNum, reps, weight, band) => {
    if (!currentSession) return;
    try {
      setSyncStatus("saving...");
      await db.logSet(currentSession.id, exercise, setNum, reps, weight, band);
      setSyncStatus("saved ✓");
      setTimeout(() => setSyncStatus(""), 2000);
    } catch (e) {
      console.error('Sync error:', e);
      setSyncStatus("save err");
    }
  }, [currentSession]);

  // Delete a set from Supabase
  const deleteFromDb = useCallback(async (exercise, setNum) => {
    if (!currentSession) return;
    try {
      await db.deleteSet(currentSession.id, exercise, setNum);
    } catch (e) {
      console.error('Delete error:', e);
    }
  }, [currentSession]);

  const saveToStorage = useCallback(() => {}, []);

  // Count progress
  const totalExercises = r.sections.reduce((s, sec) => s + sec.exercises.length, 0);
  const doneExercises = r.sections.reduce((s, sec) => {
    return s + sec.exercises.filter(ex => {
      const key = `${sessionKey}|${ex.name}`;
      return Object.keys(allSets[key] || {}).length >= ex.sets;
    }).length;
  }, 0);

  // Export data for Claude
  const exportData = () => {
    const lines = [`SESSION: ${rKey} | ${today} | Week ${week + 1} | ${activeWeeks[week].rir}`];
    r.sections.forEach(sec => {
      sec.exercises.forEach(ex => {
        const key = `${sessionKey}|${ex.name}`;
        const sets = allSets[key] || {};
        const setEntries = Object.entries(sets).sort((a, b) => a[0] - b[0]);
        if (setEntries.length > 0) {
          lines.push(`${ex.name}: ${setEntries.map(([n, d]) => `${d.reps}×${d.wt}`).join(", ")}`);
        }
      });
    });
    return lines.join("\n");
  };

  const totalSetsLogged = Object.values(allSets).reduce((s, ex) => s + Object.keys(ex).length, 0);

  const startRest = useCallback((seconds, exName, setNum, totalSets) => {
    setTimer({ seconds, exName, setNum, totalSets });
  }, []);

  const W = { background: C.bg, minHeight: "100vh", color: C.txt, fontFamily: "'SF Pro Display',system-ui,sans-serif", padding: "12px 10px", paddingTop: timer ? 64 : 12, maxWidth: 480, margin: "0 auto" };

  return (
    <div style={W}>
      {/* GLOBAL REST TIMER */}
      {timer && (
        <RestTimer
          seconds={timer.seconds}
          exName={timer.exName}
          setNum={timer.setNum}
          totalSets={timer.totalSets}
          onDone={() => setTimer(null)}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.blu, letterSpacing: -0.5 }}>TRAINING HUB</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={() => {
                if (soundOn) { disableSound(); setSoundOn(false); }
                else { enableSound(); setSoundOn(true); }
              }}
              style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${soundOn ? C.grn + "44" : C.org + "44"}`,
                background: soundOn ? C.grn + "15" : C.org + "15",
                color: soundOn ? C.grn : C.org, fontSize: 9, fontWeight: 600, cursor: "pointer" }}>
              {soundOn ? "🔊 On" : "🔇 Sound"}
            </button>
            {syncStatus && (
              <div style={{ fontSize: 8, color: syncStatus.includes("✓") || syncStatus === "ready" ? C.grn : syncStatus.includes("err") || syncStatus.includes("offline") ? C.red : C.mut }}>
                {syncStatus}
              </div>
            )}
            {totalSetsLogged > 0 && (
              <div style={{ fontSize: 9, color: C.grn, background: C.grn + "15", padding: "3px 8px", borderRadius: 10, fontWeight: 600 }}>
                {totalSetsLogged} sets
              </div>
            )}
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: dbConnected ? C.grn : C.red }} title={dbConnected ? "Connected to database" : "Offline"} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          <button onClick={() => setView("workout")}
            style={{ flex: 1, padding: "6px", borderRadius: 8, border: `1px solid ${view === "workout" ? C.blu : C.bdr}`, background: view === "workout" ? C.blu + "22" : "transparent", color: view === "workout" ? C.blu : C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Workout
          </button>
          <button onClick={() => setView("history")}
            style={{ flex: 1, padding: "6px", borderRadius: 8, border: `1px solid ${view === "history" ? C.gld : C.bdr}`, background: view === "history" ? C.gld + "22" : "transparent", color: view === "history" ? C.gld : C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            History
          </button>
        </div>
      </div>

      {/* Mesocycle selector */}
      {MESOCYCLES.length > 1 && view === "workout" && (
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {MESOCYCLES.map((m, i) => {
            const isActive = i === mesoIdx;
            const isCurrent = i === getActiveMeso(new Date().toISOString().slice(0, 10));
            return (
              <button key={m.id} onClick={() => { setMesoIdx(i); setWeek(0); setRoutine(0); }}
                style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: `1px solid ${isActive ? C.gld : C.bdr}`,
                  background: isActive ? C.gld + "22" : "transparent",
                  color: isActive ? C.gld : C.mut, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                {m.shortName}{isCurrent ? " ●" : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* HISTORY VIEW */}
      <div style={{ display: view === "history" ? "block" : "none" }}>
        <HistoryView />
      </div>

      {/* WORKOUT VIEW — use display:none instead of unmounting to preserve typed data */}
      <div style={{ display: view === "workout" ? "block" : "none" }}>
      {!loaded && (
        <div style={{ textAlign: "center", padding: 40, color: C.mut, fontSize: 12 }}>Loading session data...</div>
      )}

      {loaded && (<>
        {/* Routine tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 6, position: "sticky", top: 0, background: C.bg, zIndex: 10, paddingBottom: 4 }}>
          {activeRoutineKeys.map((k, i) => (
            <button key={k} onClick={() => setRoutine(i)}
              style={{ flex: 1, padding: "7px 2px", borderRadius: 8, border: `1px solid ${i === routine ? C.blu : C.bdr}`, background: i === routine ? C.blu + "22" : C.card, color: i === routine ? C.blu : C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
              {k}<br /><span style={{ fontSize: 8 }}>{activeRoutines[k].day}</span>
            </button>
          ))}
        </div>

        {/* Week selector */}
        <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
          {activeWeeks.map((w, i) => (
            <button key={i} onClick={() => setWeek(i)}
              style={{ flex: 1, padding: "4px 2px", borderRadius: 6, border: `1px solid ${i === week ? C.pur : C.bdr}`, background: i === week ? C.pur + "22" : "transparent", color: i === week ? C.pur : C.mut, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
              {w.deload ? (activeMeso.id === "sculpted-strength" ? "W9 DL" : "DL") : `W${i + 1}`}
            </button>
          ))}
        </div>

        {/* Week info */}
        <div style={{ background: C.c2, borderRadius: 8, padding: "7px 10px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 800, color: activeWeeks[week].deload ? C.org : C.pur }}>{activeWeeks[week].rir}</span>
            <span style={{ fontSize: 10, color: C.mut, marginLeft: 8 }}>{activeWeeks[week].note}</span>
          </div>
          <div style={{ fontSize: 10, color: doneExercises === totalExercises ? C.grn : C.mut, fontWeight: 600 }}>
            {doneExercises}/{totalExercises}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: C.c2, borderRadius: 2, marginBottom: 10, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(doneExercises / totalExercises) * 100}%`, background: `linear-gradient(90deg, ${C.blu}, ${C.grn})`, transition: "width 0.3s" }} />
        </div>


        {/* Exercise cards by section */}
        {r.sections.map((sec, si) => (
          <div key={si}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, marginTop: si > 0 ? 12 : 0 }}>{sec.name}</div>
            {sec.exercises.map((ex, ei) => (
              <ExerciseCard key={ei} ex={ex} week={week} weeksConfig={activeWeeks} sessionKey={sessionKey} allSets={allSets} setAllSets={setAllSets} onStartRest={startRest} onSave={saveToStorage} onSync={syncToDb} onDeleteFromDb={deleteFromDb} />
            ))}
          </div>
        ))}

        {/* Finish Session + Export */}
        {!showFinishReview ? (
          <div style={{ marginTop: 16, display: "flex", gap: 6 }}>
            <button onClick={() => setShowFinishReview(true)}
              style={{ flex: 1, padding: "14px", borderRadius: 10, border: `1px solid ${C.grn}44`, background: C.grn + "11", color: C.grn, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ✓ Finish Session
            </button>
            <button onClick={() => setShowExport(!showExport)}
              style={{ flex: 1, padding: "14px", borderRadius: 10, border: `1px solid ${C.blu}44`, background: C.blu + "11", color: C.blu, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              {showExport ? "Hide" : "📋 Export"}
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 16, background: C.card, borderRadius: 12, border: `1px solid ${C.grn}33`, padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.grn, marginBottom: 10 }}>Session Review</div>
            <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>
              {rKey} · {activeWeeks[week].rir} · {Math.round((Date.now() - sessionStartTime) / 60000)} min
            </div>

            {/* Review each exercise */}
            {r.sections.map((sec, si) => (
              <div key={si}>
                {sec.exercises.map((ex, ei) => {
                  const exKey = `${sessionKey}|${ex.name}`;
                  const logged = allSets[exKey] || {};
                  const setCount = Object.keys(logged).length;
                  if (setCount === 0) return null;
                  return (
                    <div key={ei} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>{ex.name}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 3 }}>
                        {Object.entries(logged).sort(([a],[b]) => a - b).map(([setNum, data]) => (
                          <div key={setNum} style={{ background: C.c2, borderRadius: 6, padding: "4px 8px", fontSize: 12, fontFamily: "monospace" }}>
                            <span style={{ color: C.mut, fontSize: 9 }}>S{setNum} </span>
                            <span style={{ color: C.blu }}>{data.reps}</span>
                            <span style={{ color: C.mut }}>×</span>
                            <span style={{ color: C.gld }}>{data.wt === 0 ? "BW" : data.wt}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Summary */}
            {(() => {
              let totalSetsR = 0, totalVol = 0;
              Object.values(allSets).forEach(ex => {
                Object.values(ex).forEach(s => { totalSetsR++; totalVol += (s.reps || 0) * (s.wt || 0); });
              });
              return (
                <div style={{ marginTop: 8, padding: "6px 8px", background: C.c2, borderRadius: 6, fontSize: 10, color: C.mut, display: "flex", justifyContent: "space-between" }}>
                  <span>Total: <span style={{ color: C.grn, fontWeight: 600 }}>{totalSetsR} sets</span></span>
                  {totalVol > 0 && <span>Volume: <span style={{ color: C.gld, fontWeight: 600 }}>{totalVol.toLocaleString()} lb</span></span>}
                </div>
              );
            })()}

            <div style={{ fontSize: 10, color: C.org, marginTop: 10, marginBottom: 10 }}>
              Tap any exercise above to go back and edit. When ready, confirm below.
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setShowFinishReview(false)}
                style={{ flex: 1, padding: "12px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                ← Back to Edit
              </button>
              <button onClick={async () => {
                  if (!currentSession) return;
                  const mins = Math.round((Date.now() - sessionStartTime) / 60000);
                  await db.finishSession(currentSession.id, mins);
                  // Advance to next routine in cycle
                  const nextRoutine = (routine + 1) % activeRoutineKeys.length;
                  try { localStorage.setItem('training-hub-next-routine', nextRoutine.toString()); } catch(e) {}
                  setRoutine(nextRoutine);
                  setAllSets({});
                  setCurrentSession(null);
                  setSyncStatus("session saved ✓ — next up: " + activeRoutineKeys[nextRoutine]);
                  setShowFinishReview(false);
                  setTimeout(() => setSyncStatus(""), 5000);
                }}
                style={{ flex: 1, padding: "12px", borderRadius: 8, border: "none", background: C.grn, color: C.bg, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                ✓ Confirm & Save
              </button>
            </div>
          </div>
        )}
        {showExport && !showFinishReview && (
          <div style={{ marginTop: 8 }}>
            <pre style={{ background: C.c2, padding: 10, borderRadius: 8, fontSize: 10, color: C.txt, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {exportData()}
            </pre>
            <button onClick={() => { navigator.clipboard?.writeText(exportData()); setCopied(true); setTimeout(() => setCopied(false), 3000); }}
              style={{ marginTop: 6, width: "100%", padding: "12px", borderRadius: 8, border: "none", background: copied ? C.grn : C.blu, color: C.bg, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              {copied ? "Copied ✓" : "Copy to Clipboard"}
            </button>
          </div>
        )}
        <div style={{ fontSize: 9, color: C.mut, textAlign: "center", marginTop: 16 }}>
          RP Hypertrophy · ForceUSA G3 · {activeMeso.name} · {today} · {dbConnected ? "☁ synced" : "offline"}
        </div>
      </>)}
      </div>
    </div>
  );
}
