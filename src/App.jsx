import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "./supabaseClient";

// === SOUND SYSTEM ===
// iOS issue: AudioContext gets suspended when screen locks or app backgrounds.
// `resume()` only works inside a user gesture, so timer callbacks can't unsuspend.
// Solution: when sound is enabled, run a silent oscillator continuously to keep
// the context alive. This is the standard web audio trick for mobile.
// AudioContext oscillators mix with Spotify (don't take over the audio session).

let _ctx = null;
let _soundEnabled = false;
let _silentNode = null;
let _silentGain = null;

function _ensureCtx() {
  if (_ctx && _ctx.state !== 'closed') {
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    return _ctx;
  }
  _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

// Start a silent oscillator to keep AudioContext alive (prevents iOS suspension)
function _startKeepAlive() {
  try {
    if (_silentNode) return;
    const ctx = _ensureCtx();
    _silentNode = ctx.createOscillator();
    _silentGain = ctx.createGain();
    _silentGain.gain.value = 0.0001; // effectively silent but not zero
    _silentNode.frequency.value = 1;
    _silentNode.connect(_silentGain);
    _silentGain.connect(ctx.destination);
    _silentNode.start();
  } catch(e) {}
}

// Track background state to prevent stale sound playback
let _appBackgrounded = false;
let _soundSuppressUntil = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _appBackgrounded = true;
    } else {
      // Suppress sounds for 500ms after returning to prevent queued playback
      _soundSuppressUntil = Date.now() + 2000;
      _appBackgrounded = false;
      if (_ctx && _soundEnabled) _ctx.resume().catch(() => {});
    }
  });
}

function _stopKeepAlive() {
  try {
    if (_silentNode) {
      _silentNode.stop();
      _silentNode.disconnect();
      _silentGain.disconnect();
      _silentNode = null;
      _silentGain = null;
    }
  } catch(e) {}
}

function enableSound() {
  try {
    const ctx = _ensureCtx();
    ctx.resume().then(() => {
      _startKeepAlive();
      // Play confirmation tone
      _playOsc(660, 0.15, 0.4);
      setTimeout(() => _playOsc(880, 0.15, 0.4), 160);
    }).catch(() => {});
  } catch(e) {}
  requestNotifPermission();
  _soundEnabled = true;
  return true;
}

function disableSound() {
  _soundEnabled = false;
  _stopKeepAlive();
  return false;
}

// === PUSH NOTIFICATION SYSTEM ===
// Uses service worker + Supabase Edge Function for true background notifications
const VAPID_PUBLIC_KEY = "BJWYcIo0sRyX_IJ-ydcbh1_mq-U0STuQvqWUvQFE45c_y0Jxg--291FakMSA28oyP_nGsglvZu_2pODypQo-uxU";

// Auto-register service worker on page load so it's ready for push
let _swRegistration = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log("PUSH: SW auto-registered on load");
        _swRegistration = reg;
        return navigator.serviceWorker.ready;
      })
      .then(reg => {
        _swRegistration = reg;
        console.log("PUSH: SW ready on load");
        // Check if already subscribed
        return reg.pushManager.getSubscription();
      })
      .then(sub => {
        if (sub) {
          _pushSubscription = sub.toJSON();
          console.log("PUSH: existing subscription found on load");
        }
      })
      .catch(e => console.error("PUSH: SW auto-register failed:", e));
  });
}
let _pushSubscription = null;
let _notifPermission = false;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) { console.log("PUSH: serviceWorker not supported"); return null; }
  try {
    // Use cached registration if available, otherwise register fresh
    if (_swRegistration) {
      console.log("PUSH: using cached SW registration");
      return _swRegistration;
    }
    console.log("PUSH: registering service worker...");
    const reg = await navigator.serviceWorker.register("/sw.js");
    console.log("PUSH: waiting for SW ready...");
    await navigator.serviceWorker.ready;
    _swRegistration = reg;
    console.log("PUSH: SW ready");
    return reg;
  } catch (e) {
    console.error("PUSH: SW registration failed:", e);
    return null;
  }
}

async function subscribeToPush(reg) {
  if (!reg) { console.log("PUSH: no registration, skipping subscribe"); return null; }
  try {
    console.log("PUSH: checking existing subscription...");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      console.log("PUSH: no existing sub, subscribing...");
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log("PUSH: subscribed!", sub);
    }
    _pushSubscription = sub.toJSON();
    console.log("PUSH: subscription JSON:", JSON.stringify(_pushSubscription).substring(0, 100));
    // Save subscription to Supabase
    console.log("PUSH: saving to Supabase...");
    const { error: pushError } = await supabase.from("push_subscriptions").upsert({
      endpoint: _pushSubscription.endpoint,
      p256dh: _pushSubscription.keys.p256dh,
      auth: _pushSubscription.keys.auth,
    }, { onConflict: "endpoint" });
    if (pushError) console.error("PUSH: save error:", pushError);
    else console.log("PUSH: saved successfully");
    return _pushSubscription;
  } catch (e) {
    console.error("Push subscribe failed:", e);
    return null;
  }
}

async function requestNotifPermission() {
  console.log("PUSH: requestNotifPermission called");
  if (!("Notification" in window)) { console.log("PUSH: Notification API not available"); return false; }
  if (Notification.permission === "granted") {
    _notifPermission = true;
    const reg = await registerServiceWorker();
    await subscribeToPush(reg);
    return true;
  }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  _notifPermission = result === "granted";
  if (_notifPermission) {
    const reg = await registerServiceWorker();
    await subscribeToPush(reg);
  }
  return _notifPermission;
}

// Send push via Supabase Edge Function (server-side delay, works in background)
async function sendPushViaServer(delaySec, title, body, tag, timerId) {
  if (!_pushSubscription) { console.log("PUSH: no subscription, skipping push for", tag); return; }
  console.log("PUSH: sending to edge function, delay:", delaySec, "tag:", tag);
  try {
    const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
    const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
    fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ subscription: _pushSubscription, title, body, delay_seconds: delaySec, tag }),
    }).catch(() => {});
  } catch (e) { console.error("Push schedule error:", e); }
}

// Schedule push notifications — only sent to server when app is backgrounded
// When app is in foreground, in-app sounds handle alerts
let _currentTimerId = null;
let _visibilityHandler = null;

function scheduleTimerNotification(seconds, exName) {
  if (!_pushSubscription) { console.log("PUSH: no subscription"); return null; }

  // Generate a unique timer ID for cancellation
  _currentTimerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const timerId = _currentTimerId;
  const timerStartedAt = Date.now();

  // Clean up any previous listener
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
  }

  _visibilityHandler = () => {
    if (document.visibilityState === 'hidden' && timerId === _currentTimerId) {
      // App just went to background — calculate remaining time and schedule pushes
      const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
      const remaining = Math.max(0, seconds - elapsed);
      console.log("PUSH: app backgrounded, remaining:", remaining, "seconds");

      if (remaining > 10) {
        sendPushViaServer(remaining - 10, "⏱ 10 seconds left", exName + " — get ready", "rest-warning", timerId);
      }
      if (remaining > 0) {
        sendPushViaServer(remaining, "✅ Rest Complete", exName + " — time for next set", "rest-done", timerId);
      }
    }
  };

  document.addEventListener('visibilitychange', _visibilityHandler);
  console.log("PUSH: timer scheduled, id:", timerId);
  return timerId;
}

function cancelTimerNotification(timerId) {
  console.log("PUSH: cancelling timer", timerId);
  // Clear the visibility listener so backgrounding won't schedule pushes
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }
  // Invalidate the timer ID so any in-flight Edge Functions check and skip
  _currentTimerId = null;
}

function _playOsc(freq, dur, vol) {
  try {
    const ctx = _ensureCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
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
  if (Date.now() < _soundSuppressUntil) return;
  if (_soundEnabled) {
    // Double high ding — louder and repeated so it cuts through
    _playOsc(880, 0.35, 0.9);
    setTimeout(() => { _playOsc(880, 0.35, 0.9); }, 350);
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function playRestBeep() {
  if (Date.now() < _soundSuppressUntil) return;
  if (_soundEnabled) {
    // Ascending three-note chime: C5, E5, G5
    _playOsc(523, 0.3, 0.7);
    setTimeout(() => { _playOsc(659, 0.3, 0.7); }, 200);
    setTimeout(() => { _playOsc(784, 0.35, 0.8); }, 400);
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
}


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

    // Look across today AND yesterday (UTC drift safety) for matching sessions
    const yest = new Date(date + 'T12:00:00');
    yest.setDate(yest.getDate() - 1);
    const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;

    // Find ALL matching sessions across today + yesterday for this routine + week
    // Search both new format (Meso 0-W1D1-Upper A) and legacy (W1-Upper A)
    const mesoTag = routineKey.match(/^(Meso \d+)/)?.[1];
    let candidateQuery = supabase
      .from('sessions')
      .select('*, sets(id)')
      .eq('week_number', weekNum)
      .ilike('notes', `%${routineSuffix}%`);
    if (mesoTag) candidateQuery = candidateQuery.ilike('notes', `${mesoTag}%`);
    const { data: candidates } = await candidateQuery;

    if (candidates && candidates.length > 0) {
      // Prefer today's session; only reuse older session if today has none
      const todaySessions = candidates.filter(c => c.date === date);
      const pool = todaySessions.length > 0 ? todaySessions : candidates;
      const sorted = [...pool].sort((a, b) => {
        const aCount = a.sets?.length || 0;
        const bCount = b.sets?.length || 0;
        if (bCount !== aCount) return bCount - aCount;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      const best = sorted[0];
      // Upgrade legacy notes to new format
      if (!best.notes.includes('Meso')) {
        await supabase.from('sessions').update({ notes: routineKey }).eq('id', best.id);
      }
      // Strip the sets array we joined for the count
      delete best.sets;
      return best;
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
  async logSet(sessionId, exerciseName, setNumber, reps, weight, band, muscles) {
    // Find exercise, auto-creating if missing so new meso exercises are never lost
    let { data: ex } = await supabase
      .from('exercises')
      .select('id')
      .eq('name', exerciseName)
      .single();

    if (!ex) {
      const cableRatio = /^Cable /i.test(exerciseName) ? 2 : 1;
      const muscleGroup = muscles ? muscles.split(/\s*[·,]\s*/)[0].trim() : null;
      const { data: created } = await supabase
        .from('exercises')
        .insert({ name: exerciseName, cable_ratio: cableRatio, muscle_group: muscleGroup })
        .select('id')
        .single();
      ex = created;
    }

    if (!ex) {
      console.error('Exercise save failed:', exerciseName);
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
      .select('*, sets(*, exercises(name, muscles, muscle_group, cable_ratio))')
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
  async getLastSessionForExercise(exerciseName, beforeDate, mesoPrefix) {
    const { data: ex } = await supabase
      .from('exercises')
      .select('id')
      .eq('name', exerciseName)
      .single();
    if (!ex) return null;

    // Get recent sessions that have this exercise, before today
    // Issue #7: Filter by meso so old program data doesn't bleed in
    let { data: sessions } = await supabase
      .from('sessions')
      .select('id, date, week_number, notes')
      .lt('date', beforeDate || '9999-12-31')
      .order('date', { ascending: false })
      .limit(10);
    if (mesoPrefix) { sessions = (sessions||[]).filter(s => s.notes && s.notes.startsWith(mesoPrefix)); }

    if (!sessions || sessions.length === 0) return null;

    // For each recent session, check if it has sets for this exercise
    for (const session of sessions) {
      const { data: sets } = await supabase
        .from('sets')
        .select('reps, weight, set_number')
        .eq('session_id', session.id)
        .eq('exercise_id', ex.id);

      if (sets && sets.length > 0) {
        return { date: session.date, weekNumber: session.week_number, rir: session.rir, sets };
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
  },

  async getAllSets() {
    const { data } = await supabase.from('sets').select('*').order('created_at', { ascending: true });
    return data || [];
  },

  async getAllSessions() {
    const { data } = await supabase.from('sessions').select('*').order('date', { ascending: true });
    return data || [];
  },

  async getAllExercises() {
    const { data } = await supabase.from('exercises').select('*').order('name', { ascending: true });
    return data || [];
  },

  async getAllMesocycles() {
    const { data } = await supabase.from('mesocycles').select('*').order('start_date', { ascending: true });
    return data || [];
  },

  async getHealthDaily(limit = 400) {
    const { data } = await supabase.from('health_daily').select('*').order('date', { ascending: true }).limit(limit);
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
    day: "D1", sections: [
      { name: "Chest", exercises: [
        { name: "Smith Flat Bench Press", muscles: "Chest", sets: 3, reps: "8-10", rest: 150, wt: 120,
          vid: "https://www.muscleandstrength.com/exercises/smith-machine-bench-press.html", src: "M&S" },
        { name: "Smith Incline Press", muscles: "Upper Chest", sets: 3, reps: "10-12", rest: 120, wt: 75,
          vid: "https://www.muscleandstrength.com/exercises/incline-smith-machine-bench-press.html", src: "M&S" },
      ]},
      { name: "Back", exercises: [
        { name: "Chin-Ups (Wide Overhand)", muscles: "Lats · Upper Back", sets: 3, reps: "6-10", rest: 150, wt: null, bodyweight: true,
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
    day: "D2", sections: [
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
    day: "D3", sections: [
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
    day: "D4", sections: [
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
        { name: "Hanging Knee Raise", muscles: "Abs", sets: 3, reps: "12-15", rest: 60, wt: null, bodyweight: true, bodyweight: true,
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

// Local date in YYYY-MM-DD format (not UTC, so it doesn't shift at midnight UTC)
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const BAND_COLORS = { Green: "#22c55e", Purple: "#a78bfa", Black: "#888", Red: "#ff5c5c", None: "#00e5a0" };

const SetRow = React.memo(function SetRow({ setNum, isLastSet, targetReps, targetWt, lastWeight, isBW, bands, onLog, onDelete, onRir, logged }) {
  // Local state ONLY used when actively editing or entering new data
  const initWt = lastWeight != null ? lastWeight.toString() : (targetWt?.toString() || (isBW ? "0" : ""));
  const [editReps, setEditReps] = useState(targetReps || "");
  const [editWt, setEditWt] = useState(initWt);
  const [band, setBand] = useState(bands ? bands[0] : null);
  const [editing, setEditing] = useState(false);
  const [showRirPicker, setShowRirPicker] = useState(false);
  const isDone = logged != null && !editing;
  const userEditedReps = useRef(false);
  const userEditedWt = useRef(false);

  // Sync presets when smart targets resolve asynchronously after the DB call.
  // Guard with userEdited refs so manual input is never clobbered.
  useEffect(() => {
    if (!isDone && !editing && !userEditedReps.current) {
      setEditReps(targetReps || "");
    }
  }, [targetReps]);

  // Only sync weight for the first set (lastWeight null = no cascade yet).
  // For set 2+ the cascade from the previous logged set takes priority.
  useEffect(() => {
    if (!isDone && !editing && !userEditedWt.current && lastWeight == null) {
      setEditWt(targetWt?.toString() || (isBW ? "0" : ""));
    }
  }, [targetWt]);

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
      const wasEditing = editing;
      onLog(setNum, data);
      setEditing(false);
      if (!wasEditing && isLastSet) setShowRirPicker(true);
    }
  };

  const handleEdit = (e) => {
    e.stopPropagation();
    startEdit();
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete(setNum);
    userEditedReps.current = false;
    userEditedWt.current = false;
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
      if (isLastSet) setShowRirPicker(true);
    }
  };

  return (
    <>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: showRirPicker ? 2 : 4 }}>
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
            {logged.rir != null && <span style={{ fontSize: 9, color: C.pur, fontWeight: 700, marginLeft: 6 }}>{logged.rir}RIR</span>}
          </div>
          <button onClick={handleEdit} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: C.c2, color: C.mut, fontSize: 10, cursor: "pointer" }}>Edit</button>
          <button onClick={handleDelete} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.red}22`, background: C.red + "11", color: C.red, fontSize: 10, cursor: "pointer" }}>✕</button>
        </>
      ) : (
        <>
          <input type="number" inputMode="numeric" placeholder={targetReps} value={editReps}
            onChange={e => { userEditedReps.current = true; setEditReps(e.target.value); }}
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
              <input type="number" inputMode="decimal" placeholder={targetWt || "wt"} value={editWt}
                onChange={e => { userEditedWt.current = true; setEditWt(e.target.value); }}
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
    {showRirPicker && (
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 34, marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: C.mut, marginRight: 2 }}>RIR:</span>
        {[0, 1, 2, 3, "4+"].map(r => (
          <button key={r} onClick={() => { if (onRir) onRir(setNum, typeof r === "string" ? 4 : r); setShowRirPicker(false); }}
            style={{ width: 30, height: 24, borderRadius: 5, border: `1px solid ${C.pur}55`, background: C.pur + "22", color: C.pur, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {r}
          </button>
        ))}
        <button onClick={() => setShowRirPicker(false)} style={{ padding: "2px 6px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 10, cursor: "pointer" }}>✕</button>
      </div>
    )}
    </>
  );
}, (prev, next) => {
  return prev.setNum === next.setNum
    && prev.targetWt === next.targetWt
    && prev.targetReps === next.targetReps
    && prev.isBW === next.isBW
    && prev.logged?.reps === next.logged?.reps
    && prev.logged?.wt === next.logged?.wt
    && prev.logged?.band === next.logged?.band
    && prev.logged?.rir === next.logged?.rir
    && prev.lastWeight === next.lastWeight
    && (prev.logged == null) === (next.logged == null);
});

function RestTimer({ seconds, exName, setNum, totalSets, onDone, nextSetInfo, onLogFromTimer }) {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const startTimeRef = useRef(Date.now());
  const ref = useRef(null);
  const warnedRef = useRef(false);
  const alertedRef = useRef(false);
  const autoAdvancedRef = useRef(false);
  const [showNextSet, setShowNextSet] = useState(false);
  const [logReps, setLogReps] = useState("");
  const [logWt, setLogWt] = useState("");
  const touchStartY = useRef(null);


  // Issue #1: Schedule notification for background alert
  const notifRef = useRef(null);
  useEffect(() => {
    notifRef.current = scheduleTimerNotification(seconds, exName);
    return () => cancelTimerNotification(notifRef.current);
  }, []);

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
      // Issue #3: Auto-expand so Next Set button is tappable
      if (!expanded) setExpanded(true);
    }
  }, [elapsed, seconds, expanded]);

  // Time's up chime
  useEffect(() => {
    if (elapsed >= seconds && !alertedRef.current) {
      alertedRef.current = true;
      playRestBeep();
    }
    // Show next set card after timer completes
    if (elapsed >= seconds && !autoAdvancedRef.current) {
      autoAdvancedRef.current = true;
      clearInterval(ref.current);
      if (nextSetInfo && onLogFromTimer) {
        setLogReps(nextSetInfo.targetReps || "");
        setLogWt(nextSetInfo.targetWt?.toString() || "");
        setShowNextSet(true);
      } else {
        onDone();
      }
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

  // NEXT SET CARD — shown after rest timer completes
  if (showNextSet && nextSetInfo) {
    const nsi = nextSetInfo;
    return (
      <div
        onTouchStart={e => { touchStartY.current = e.touches[0].clientY; }}
        onTouchEnd={e => {
          if (touchStartY.current !== null) {
            const dy = touchStartY.current - e.changedTouches[0].clientY;
            if (dy > 60) { onDone(); } // Swipe up > 60px = dismiss
            touchStartY.current = null;
          }
        }}
        style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: C.bdr, marginBottom: 16 }}></div>
        <div style={{ fontSize: 12, color: C.grn, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Next Set</div>
        <div style={{ fontSize: 20, color: C.txt, fontWeight: 800, marginBottom: 6 }}>{nsi.exName}</div>
        <div style={{ fontSize: 12, color: C.mut, marginBottom: 20 }}>{nsi.muscles}</div>

        <div style={{ fontSize: 14, color: C.pur, marginBottom: 20, fontWeight: 600 }}>
          Set {nsi.nextSetNum} of {nsi.totalSets}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 10, color: C.mut, textAlign: "center", marginBottom: 4 }}>REPS</div>
            <input type="number" inputMode="numeric" value={logReps} onChange={e => setLogReps(e.target.value)}
              onFocus={e => e.target.select()}
              style={{ width: 64, padding: "10px", borderRadius: 10, border: `1px solid ${C.bdr}`, background: C.c2, color: C.txt, fontSize: 20, textAlign: "center", fontWeight: 700 }} />
          </div>
          <div style={{ fontSize: 20, color: C.mut, marginTop: 16 }}>×</div>
          {nsi.isBW ? (
            <div style={{ fontSize: 20, color: C.teal, fontWeight: 700, marginTop: 16 }}>BW</div>
          ) : (
            <div>
              <div style={{ fontSize: 10, color: C.mut, textAlign: "center", marginBottom: 4 }}>WEIGHT</div>
              <input type="number" inputMode="decimal" value={logWt} onChange={e => setLogWt(e.target.value)}
                onFocus={e => e.target.select()}
                style={{ width: 80, padding: "10px", borderRadius: 10, border: `1px solid ${C.bdr}`, background: C.c2, color: C.txt, fontSize: 20, textAlign: "center", fontWeight: 700 }} />
              <div style={{ fontSize: 10, color: C.mut, textAlign: "center", marginTop: 2 }}>lb</div>
            </div>
          )}
        </div>

        {nsi.nextSetNum === nsi.totalSets ? (
          <>
            <div style={{ fontSize: 10, color: C.mut, marginBottom: 8, textAlign: "center", letterSpacing: 0.5 }}>REPS IN RESERVE — tap to log final set</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, width: "100%" }}>
              {[0, 1, 2, 3, "4+"].map(r => {
                const rirVal = typeof r === "string" ? 4 : r;
                return (
                  <button key={r} onClick={() => {
                      const reps = parseInt(logReps); const w = nsi.isBW ? 0 : parseFloat(logWt);
                      if (reps && (nsi.isBW || w >= 0)) { onLogFromTimer(nsi.exName, nsi.nextSetNum, { reps, wt: w, rir: rirVal }, nsi); }
                    }}
                    style={{ flex: 1, padding: "18px 0", borderRadius: 14, border: `1px solid ${C.pur}55`, background: C.pur + "22", color: C.pur, fontSize: 20, fontWeight: 800, cursor: "pointer" }}>
                    {r}
                  </button>
                );
              })}
            </div>
            <button onClick={() => {
                const r = parseInt(logReps); const w = nsi.isBW ? 0 : parseFloat(logWt);
                if (r && (nsi.isBW || w >= 0)) { onLogFromTimer(nsi.exName, nsi.nextSetNum, { reps: r, wt: w }, nsi); }
              }}
              style={{ padding: "10px 32px", borderRadius: 10, border: `1px solid ${C.grn}44`, background: C.grn + "11", color: C.grn, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
              Log without RIR ✓
            </button>
          </>
        ) : (
          <button onClick={() => {
              const r = parseInt(logReps); const w = nsi.isBW ? 0 : parseFloat(logWt);
              if (r && (nsi.isBW || w >= 0)) { onLogFromTimer(nsi.exName, nsi.nextSetNum, { reps: r, wt: w }, nsi); }
            }}
            style={{ padding: "16px 60px", borderRadius: 14, border: "none", background: C.grn, color: C.bg, fontSize: 16, fontWeight: 800, cursor: "pointer", marginBottom: 12 }}>
            Log Set {nsi.nextSetNum} ✓
          </button>
        )}
        <button onClick={() => onDone()}
          style={{ padding: "8px 20px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 11, cursor: "pointer" }}>
          Skip — log manually
        </button>
      </div>
    );
  }

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

function saveSessionPerformance(allSets, sessionKey, weekNumber, rir, mesoPrefix) {
  if (!mesoPrefix) return;
  const perfKey = 'training-hub-perf-' + mesoPrefix.replace(/\s+/g, '-');
  let perf = {};
  try { perf = JSON.parse(localStorage.getItem(perfKey) || '{}'); } catch(e) {}
  Object.entries(allSets).forEach(([key, sets]) => {
    if (!key.startsWith(sessionKey + '|')) return;
    const exName = key.slice(sessionKey.length + 1);
    const setArr = Object.values(sets);
    if (setArr.length === 0) return;
    const avgWt = setArr.reduce((a, s) => a + (parseFloat(s.wt) || 0), 0) / setArr.length;
    const avgReps = setArr.reduce((a, s) => a + (parseInt(s.reps) || 0), 0) / setArr.length;
    // Use last set's RIR — the only set performed under full accumulated fatigue
    const setsWithRir = setArr.filter(s => s.rir != null);
    const lastRir = setsWithRir.length > 0 ? setsWithRir[setsWithRir.length - 1].rir : null;
    perf[exName] = { avgWt, avgReps, weekNumber, rir, avgRir: lastRir };
  });
  try { localStorage.setItem(perfKey, JSON.stringify(perf)); } catch(e) {}
}

function ExerciseCard({ ex, week, weeksConfig, sessionKey, allSets, setAllSets, onStartRest, onSave, onSync, onDeleteFromDb, mesoPrefix, isLastExercise }) {
  const [expanded, setExpanded] = useState(false);
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

  // Helper: run the progression computation given raw perf data
  function computeAdjustment(avgWt, avgReps, lastWk, lastRir, lastAvgRir) {
    if (lastWk >= (week + 1)) return {};
    const repRange = ex.reps.split("-").map(Number);
    const minReps = repRange[0], maxReps = repRange[1] || repRange[0];
    let adjusted, note, repsAdj = null;
    if (avgReps < minReps) {
      adjusted = Math.round(avgWt / minStep) * minStep;
      note = `⏸ Holding @ ${Math.round(avgWt)} lb — only ${Math.round(avgReps)} reps last session (min ${minReps})`;
    } else if (avgReps > maxReps) {
      adjusted = Math.round((avgWt + weeklyAdd + minStep) / minStep) * minStep;
      note = `↑ Bumped — ${Math.round(avgReps)} reps @ ${Math.round(avgWt)} lb last session (exceeded range)`;
    } else {
      // RIR-aware progression: compare logged RIR to the session's target RIR
      const targetRirLow = lastRir ? parseInt(lastRir) : null;
      let add = weeklyAdd;
      if (lastAvgRir != null && targetRirLow != null) {
        const rirDiff = lastAvgRir - targetRirLow;
        if (rirDiff >= 2) {
          add = weeklyAdd + minStep;
          note = `↑↑ Extra bump — ${Math.round(lastAvgRir)} RIR logged vs ${targetRirLow} target`;
        } else if (rirDiff <= -2) {
          adjusted = Math.round(avgWt / minStep) * minStep;
          note = `⏸ Holding — ${Math.round(lastAvgRir)} RIR logged (grinding past target)`;
        }
      }
      if (adjusted === undefined) {
        adjusted = Math.round((avgWt + add) / minStep) * minStep;
        const rirTag = lastRir ? ` (${lastRir})` : "";
        if (!note) {
          if (avgWt < ex.wt - minStep / 2) note = `↓ ${Math.round(avgWt)} lb used last${rirTag} → ${adjusted} lb this week`;
          else if (avgWt > ex.wt + minStep / 2) note = `↑ ${Math.round(avgWt)} lb used last${rirTag} → ${adjusted} lb this week`;
        }
      }
      if (adjusted === Math.round(avgWt / minStep) * minStep) repsAdj = maxReps;
    }
    if (adjusted !== undefined && adjusted !== baseTarget) return { smartTarget: adjusted, progressNote: note || null, smartTargetReps: repsAdj };
    return {};
  }

  // Fast path: read from localStorage (written at session finish)
  const lsResult = useMemo(() => {
    if (!ex.wt || wkData.deload) return null;
    const perfKey = 'training-hub-perf-' + mesoPrefix.replace(/\s+/g, '-');
    let perf = {};
    try { perf = JSON.parse(localStorage.getItem(perfKey) || '{}'); } catch(e) {}
    const last = perf[ex.name];
    if (!last || last.avgWt == null) return null;
    return computeAdjustment(last.avgWt, last.avgReps, last.weekNumber || 0, last.rir || "", last.avgRir ?? null);
  }, [ex.name, ex.wt, ex.reps, week, mesoPrefix, baseTarget, weeklyAdd, minStep, wkData.deload]);

  // Async DB fallback: only fires when localStorage has no data for this exercise
  const [dbResult, setDbResult] = useState(null);
  useEffect(() => {
    if (!ex.wt || wkData.deload) return;
    const perfKey = 'training-hub-perf-' + mesoPrefix.replace(/\s+/g, '-');
    let perf = {};
    try { perf = JSON.parse(localStorage.getItem(perfKey) || '{}'); } catch(e) {}
    if (perf[ex.name]) { setDbResult(null); return; } // localStorage has it — no DB needed
    setDbResult(null);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    db.getLastSessionForExercise(ex.name, tomorrow, mesoPrefix).then(last => {
      if (!last || !last.sets || last.sets.length === 0) return;
      const avgWt = last.sets.reduce((a, s) => a + s.weight, 0) / last.sets.length;
      const avgReps = last.sets.reduce((a, s) => a + s.reps, 0) / last.sets.length;
      const lastWk = last.weekNumber || 0;
      const lastRir = last.rir || "";
      // Cache in localStorage so future loads are instant
      try {
        const stored = JSON.parse(localStorage.getItem(perfKey) || '{}');
        stored[ex.name] = { avgWt, avgReps, weekNumber: lastWk, rir: lastRir };
        localStorage.setItem(perfKey, JSON.stringify(stored));
      } catch(e) {}
      setDbResult(computeAdjustment(avgWt, avgReps, lastWk, lastRir, null));
    }).catch(() => {});
  }, [ex.name, week]);

  const merged = lsResult || dbResult || {};
  const smartTarget = merged.smartTarget || null;
  const progressNote = merged.progressNote || null;
  const smartTargetReps = merged.smartTargetReps || null;

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
    onSync(ex.name, setNum, data.reps, data.wt, data.band, ex.muscles);
    const isLastSet = setNum >= totalSets;
    if (!(isLastExercise && isLastSet)) {
      onStartRest(wkData.deload ? Math.min(ex.rest, 75) : ex.rest, ex.name, setNum, totalSets);
    }
  };

  const deleteSet = (setNum) => {
    setAllSets(prev => {
      const prevEx = { ...(prev[exKey] || {}) };
      delete prevEx[setNum];
      return { ...prev, [exKey]: prevEx };
    });
    if (onDeleteFromDb) onDeleteFromDb(ex.name, setNum);
  };

  const handleRir = (setNum, rir) => {
    setAllSets(prev => {
      const prevEx = prev[exKey] || {};
      const prevSet = prevEx[setNum];
      if (!prevSet) return prev;
      return { ...prev, [exKey]: { ...prevEx, [setNum]: { ...prevSet, rir } } };
    });
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
            <span style={{ color: C.mut }}>Rest: <span style={{ color: C.pur, fontWeight: 600 }}>{fmtRest(wkData.deload ? Math.min(ex.rest, 75) : ex.rest)}</span></span>
            {targetWt && <span style={{ color: C.mut }}>Wt: <span style={{ color: smartTarget ? C.org : C.gld, fontWeight: 600 }}>{targetWt} lb{smartTarget ? " *" : ""}</span></span>}
          </div>
          {progressNote && (
            <div style={{ fontSize: 10, color: C.org, padding: "3px 7px", background: C.org + "11", borderRadius: 5, marginBottom: 8 }}>
              {progressNote}
            </div>
          )}

          {Array.from({ length: totalSets }, (_, i) => (
            <SetRow key={i} setNum={i + 1} isLastSet={i + 1 === totalSets} targetReps={smartTargetReps ? String(smartTargetReps) : ex.reps.split("-")[0]} targetWt={targetWt} lastWeight={lastWeightRef.current} isBW={!!ex.bodyweight} bands={ex.bands} logged={logged[i + 1]} onLog={logSet} onDelete={deleteSet} onRir={handleRir} />
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
  const [addingSet, setAddingSet] = useState(null); // { sessionId, exName, muscles, nextNum }
  const [addSetFields, setAddSetFields] = useState({ reps: '', weight: '' });
  const [addingExercise, setAddingExercise] = useState(null); // { sessionId, exName, muscles }
  const [addExFields, setAddExFields] = useState({ reps: '', weight: '' });

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

  // All exercises from all mesocycles, deduplicated and sorted
  const allProgrammedExercises = (() => {
    const seen = new Set();
    const result = [];
    Object.values(MESOCYCLES).forEach(meso => {
      Object.values(meso.routines || {}).forEach(r => {
        (r.sections || []).forEach(sec => {
          (sec.exercises || []).forEach(ex => {
            if (!seen.has(ex.name)) { seen.add(ex.name); result.push({ name: ex.name, muscles: ex.muscles || '' }); }
          });
        });
      });
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  })();

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
                    {ex.sets.map(s => {
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
                                <span style={{ color: C.gld }}>{s.weight === 0 && ["Chin-Ups (Wide Overhand)","Hanging Knee Raise"].includes(s.exercises?.name) ? "BW" : s.weight}</span>
                                {s.weight > 0 && <span style={{ color: C.mut, fontSize: 9 }}> lb</span>}
                                {s.notes && s.notes.startsWith('band:') && (
                                  <span style={{ fontSize: 9, color: BAND_COLORS[s.notes.replace('band:','')] || C.mut, marginLeft: 4, fontWeight: 600 }}>
                                    {s.notes.replace('band:','')}
                                  </span>
                                )}
                              </div>
                              <button onClick={() => { setEditingSetId(s.id); setEditSetFields({ reps: s.reps.toString(), weight: (s.weight === 0 && !["Chin-Ups (Wide Overhand)","Hanging Knee Raise"].includes(s.exercises?.name)) ? '' : s.weight.toString() }); }}
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
                    {addingSet && addingSet.sessionId === session.id && addingSet.exName === ex.name ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, paddingLeft: 8 }}>
                        <input type="number" inputMode="numeric" placeholder="reps" value={addSetFields.reps}
                          onChange={e => setAddSetFields(f => ({...f, reps: e.target.value}))}
                          onFocus={e => e.target.select()}
                          style={{ width: 38, padding: "3px", borderRadius: 4, border: `1px solid ${C.grn}55`, background: C.c2, color: C.txt, fontSize: 11, textAlign: "center" }} />
                        <span style={{ color: C.mut, fontSize: 11 }}>×</span>
                        <input type="number" inputMode="decimal" placeholder="lb" value={addSetFields.weight}
                          onChange={e => setAddSetFields(f => ({...f, weight: e.target.value}))}
                          onFocus={e => e.target.select()}
                          style={{ width: 46, padding: "3px", borderRadius: 4, border: `1px solid ${C.grn}55`, background: C.c2, color: C.txt, fontSize: 11, textAlign: "center" }} />
                        <button onClick={async () => {
                            const reps = parseInt(addSetFields.reps);
                            const weight = parseFloat(addSetFields.weight) || 0;
                            if (!reps) return;
                            await db.logSet(session.id, ex.name, addingSet.nextNum, reps, weight, null, ex.muscles);
                            const { data: fresh } = await supabase.from('sets').select('*, exercises(name, muscles, muscle_group, cable_ratio)').eq('session_id', session.id).order('set_number', { ascending: true });
                            setSessions(prev => prev.map(sess => sess.id === session.id ? { ...sess, sets: fresh || sess.sets } : sess));
                            setAddingSet(null);
                            setAddSetFields({ reps: '', weight: '' });
                          }}
                          style={{ padding: "2px 8px", borderRadius: 4, border: "none", background: C.grn, color: C.bg, fontSize: 9, fontWeight: 700, cursor: "pointer" }}>
                          ✓
                        </button>
                        <button onClick={() => { setAddingSet(null); setAddSetFields({ reps: '', weight: '' }); }}
                          style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 9, cursor: "pointer" }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { setAddingSet({ sessionId: session.id, exName: ex.name, muscles: ex.muscles, nextNum: ex.sets.length + 1 }); setAddSetFields({ reps: '', weight: '' }); }}
                        style={{ marginTop: 4, marginLeft: 8, padding: "2px 10px", borderRadius: 4, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 9, cursor: "pointer" }}>
                        + set
                      </button>
                    )}
                  </div>
                ))}
                {/* Add a missing exercise to this session */}
                {addingExercise && addingExercise.sessionId === session.id ? (
                  <div style={{ marginTop: 10, background: C.c2, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Add Exercise</div>
                    <select value={addingExercise.exName}
                      onChange={e => {
                        const found = allProgrammedExercises.find(ex => ex.name === e.target.value);
                        setAddingExercise(prev => ({ ...prev, exName: e.target.value, muscles: found?.muscles || '' }));
                      }}
                      style={{ width: "100%", padding: "6px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.card, color: C.txt, fontSize: 12, marginBottom: 8 }}>
                      <option value="">— pick an exercise —</option>
                      {allProgrammedExercises.map(ex => <option key={ex.name} value={ex.name}>{ex.name}</option>)}
                    </select>
                    {addingExercise.exName && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="number" inputMode="numeric" placeholder="reps" value={addExFields.reps}
                          onChange={e => setAddExFields(f => ({...f, reps: e.target.value}))}
                          onFocus={e => e.target.select()}
                          style={{ width: 48, padding: "4px", borderRadius: 5, border: `1px solid ${C.grn}55`, background: C.card, color: C.txt, fontSize: 12, textAlign: "center" }} />
                        <span style={{ color: C.mut }}>×</span>
                        <input type="number" inputMode="decimal" placeholder="lb" value={addExFields.weight}
                          onChange={e => setAddExFields(f => ({...f, weight: e.target.value}))}
                          onFocus={e => e.target.select()}
                          style={{ width: 56, padding: "4px", borderRadius: 5, border: `1px solid ${C.grn}55`, background: C.card, color: C.txt, fontSize: 12, textAlign: "center" }} />
                        <span style={{ color: C.mut, fontSize: 10 }}>lb</span>
                        <button onClick={async () => {
                            const reps = parseInt(addExFields.reps);
                            const weight = parseFloat(addExFields.weight) || 0;
                            if (!reps) return;
                            const existingSetsForEx = (session.sets || []).filter(s => s.exercises?.name === addingExercise.exName);
                            const nextSetNum = existingSetsForEx.length > 0 ? Math.max(...existingSetsForEx.map(s => s.set_number)) + 1 : 1;
                            await db.logSet(session.id, addingExercise.exName, nextSetNum, reps, weight, null, addingExercise.muscles);
                            const { data: fresh } = await supabase.from('sets').select('*, exercises(name, muscles, muscle_group, cable_ratio)').eq('session_id', session.id).order('set_number', { ascending: true });
                            setSessions(prev => prev.map(s => s.id === session.id ? { ...s, sets: fresh || s.sets } : s));
                            setAddingExercise(null); setAddExFields({ reps: '', weight: '' });
                          }}
                          style={{ padding: "4px 12px", borderRadius: 5, border: "none", background: C.grn, color: C.bg, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          ✓ Add
                        </button>
                        <button onClick={() => { setAddingExercise(null); setAddExFields({ reps: '', weight: '' }); }}
                          style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 10, cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button onClick={() => { setAddingExercise({ sessionId: session.id, exName: '', muscles: '' }); setAddExFields({ reps: '', weight: '' }); }}
                    style={{ marginTop: 10, padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mut, fontSize: 10, cursor: "pointer" }}>
                    + add exercise
                  </button>
                )}

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

// ============================================================
// ANALYTICS PORTAL — Body Comp + Performance + Recovery + Compare
// ============================================================
function fmtShortDate(s) {
  if (!s) return "";
  var parts = s.slice(0, 10).split("-");
  if (parts.length !== 3) return s;
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[parseInt(parts[1], 10) - 1] + " " + parseInt(parts[2], 10);
}
function fmtSignedNum(n, dp) {
  if (n == null || isNaN(n)) return "—";
  var p = (dp == null ? 1 : dp);
  return (n > 0 ? "+" : "") + n.toFixed(p);
}
function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
function deriveBodyComp(r) {
  var wKg = r.weight_kg != null ? parseFloat(r.weight_kg) : null;
  var w = r.weight_lbs != null ? parseFloat(r.weight_lbs) : (wKg != null ? +(wKg * 2.20462).toFixed(1) : null);
  var bf = r.body_fat_pct != null ? parseFloat(r.body_fat_pct) : null;
  var lean = r.lean_mass_lbs != null ? parseFloat(r.lean_mass_lbs)
    : (w != null && bf != null ? +(w * (1 - bf / 100)).toFixed(2) : null);
  var fat = r.fat_mass_lbs != null ? parseFloat(r.fat_mass_lbs)
    : (w != null && bf != null ? +(w * bf / 100).toFixed(2) : null);
  return { date: r.date, weight: w, bf: bf, lean: lean, fat: fat, raw: r };
}
function smaSeries(arr, getVal, winSize) {
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var sum = 0, n = 0;
    for (var j = Math.max(0, i - winSize + 1); j <= i; j++) {
      var v = getVal(arr[j]);
      if (v != null && !isNaN(v)) { sum += v; n++; }
    }
    out.push({ date: arr[i].date, val: n > 0 ? sum / n : null });
  }
  return out;
}
var META_MESO_START = "2026-04-14";
function TrendChart(props) {
  var data = (props.data || []).filter(function(d) { return d.val != null && !isNaN(d.val); });
  if (data.length < 2) {
    return (
      <div style={{ color: C.mut, fontSize: 11, padding: "12px 0" }}>
        Not enough data yet
      </div>
    );
  }
  var W = 320, H = 130, pad = { l: 32, r: 8, t: 10, b: 20 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var vals = data.map(function(d) { return d.val; });
  var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
  var vRange = vMax - vMin || Math.max(Math.abs(vMax) * 0.1, 1);
  vMin = vMin - vRange * 0.15; vMax = vMax + vRange * 0.15; vRange = vMax - vMin || 1;
  var dates = data.map(function(d) { return new Date(d.date).getTime(); });
  var tMin = dates[0], tMax = dates[dates.length - 1], tRange = tMax - tMin || 1;
  function xTC(t) { return pad.l + ((t - tMin) / tRange) * iw; }
  function yTC(val) { return pad.t + (1 - (val - vMin) / vRange) * ih; }
  var d2 = data.map(function(d, i) {
    var px = xTC(new Date(d.date).getTime()), py = yTC(d.val);
    return (i === 0 ? "M" : "L") + px.toFixed(1) + "," + py.toFixed(1);
  }).join("");
  var color = props.color || C.blu;
  var unit = props.unit || "";
  var markerX = null;
  if (props.markerDate) {
    var mt = new Date(props.markerDate).getTime();
    if (mt >= tMin && mt <= tMax) markerX = xTC(mt);
  }
  var fmt = function(val) {
    if (unit === "%") return val.toFixed(1);
    if (Math.abs(val) >= 100) return val.toFixed(0);
    return val.toFixed(1);
  };
  return (
    <svg
      viewBox={"0 0 " + W + " " + H}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map(function(t, i) {
        var gv = vMin + vRange * (1 - t);
        return (
          <g key={"g" + i}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={pad.t + ih * t}
              y2={pad.t + ih * t}
              stroke={C.bdr}
              strokeWidth={1}
              strokeDasharray="2,3" />
            <text
              x={pad.l - 4}
              y={pad.t + ih * t + 3}
              fill={C.mut}
              fontSize={9}
              textAnchor="end">
              {fmt(gv)}
            </text>
          </g>
        );
      })}
      {markerX != null ? <g key="m">
        <line
          x1={markerX}
          x2={markerX}
          y1={pad.t}
          y2={pad.t + ih}
          stroke={C.pur}
          strokeWidth={1}
          strokeDasharray="3,3"
          opacity={0.8} />
        <text x={markerX + 3} y={pad.t + 9} fill={C.pur} fontSize={8} fontWeight={700}>
          M1
        </text>
      </g> : null}
      <path
        d={d2}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round" />
      {data.map(function(d, i) {
        var px = xTC(new Date(d.date).getTime()), py = yTC(d.val);
        return (
          <circle
            key={i}
            cx={px}
            cy={py}
            r={3.2}
            fill={color}
            stroke={C.bg}
            strokeWidth={0.8}
            style={{ cursor: props.onTap ? "pointer" : "default" }}
            onClick={function() { if (props.onTap) props.onTap(d, i); }} />
        );
      })}
      <text x={pad.l} y={H - 4} fill={C.mut} fontSize={9} textAnchor="start">
        {fmtShortDate(data[0].date)}
      </text>
      {data.length > 4 ? <text
        x={pad.l + iw / 2}
        y={H - 4}
        fill={C.mut}
        fontSize={9}
        textAnchor="middle">
        {fmtShortDate(data[Math.floor(data.length / 2)].date)}
      </text> : null}
      <text x={W - pad.r} y={H - 4} fill={C.mut} fontSize={9} textAnchor="end">
        {fmtShortDate(data[data.length - 1].date)}
      </text>
    </svg>
  );
}
function BarsChart(props) {
  var data = props.data || [];
  if (data.length === 0) {
    return (
      <div style={{ color: C.mut, fontSize: 11, padding: "12px 0" }}>
        No data
      </div>
    );
  }
  var W = 320, H = 24 * data.length + 14, pad = { l: 90, r: 28, t: 4, b: 4 };
  var iw = W - pad.l - pad.r;
  var maxV = Math.max(props.maxOverride || 0, Math.max.apply(null, data.map(function(d) { return d.val || 0; })));
  if (props.bands && props.bands.mrv) maxV = Math.max(maxV, props.bands.mrv * 1.1);
  if (maxV < 1) maxV = 1;
  return (
    <svg
      viewBox={"0 0 " + W + " " + H}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="xMidYMid meet">
      {props.bands ? <g key="bands" opacity={0.18}>
        {props.bands.mev ? <rect
          x={pad.l}
          y={pad.t}
          width={(props.bands.mev / maxV) * iw}
          height={H - pad.t - pad.b}
          fill={C.red} /> : null}
        {props.bands.mav ? <rect
          x={pad.l + ((props.bands.mev || 0) / maxV) * iw}
          y={pad.t}
          width={((props.bands.mav - (props.bands.mev || 0)) / maxV) * iw}
          height={H - pad.t - pad.b}
          fill={C.grn} /> : null}
        {props.bands.mrv ? <rect
          x={pad.l + ((props.bands.mav || 0) / maxV) * iw}
          y={pad.t}
          width={((props.bands.mrv - (props.bands.mav || 0)) / maxV) * iw}
          height={H - pad.t - pad.b}
          fill={C.gld} /> : null}
      </g> : null}
      {data.map(function(d, i) {
        var by = pad.t + i * 24 + 3, bw = ((d.val || 0) / maxV) * iw, color = d.color || C.blu;
        var cb = typeof props.onBar === "function";
        return (
          <g
            key={i}
            onClick={cb ? (function(dd) { return function() { props.onBar(dd); }; })(d) : undefined}
            style={cb ? { cursor: "pointer" } : undefined}>
            <text
              x={pad.l - 6}
              y={by + 12}
              fill={C.txt}
              fontSize={11}
              textAnchor="end"
              fontWeight={cb ? "600" : "normal"}>
              {d.label}
            </text>
            <rect x={pad.l} y={by} width={bw} height={16} fill={color} rx={2} />
            <text
              x={pad.l + bw + 4}
              y={by + 12}
              fill={C.mut}
              fontSize={10}
              textAnchor="start">
              {(d.val || 0).toFixed(d.dp == null ? 0 : d.dp) + (d.unit || "")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
function MultiSeriesChart(props) {
  var series = props.series || [], allPoints = [];
  series.forEach(function(s) { (s.points || []).forEach(function(p) { if (p.val != null && !isNaN(p.val)) allPoints.push(p); }); });
  if (allPoints.length < 2) {
    return (
      <div style={{ color: C.mut, fontSize: 11, padding: "12px 0" }}>
        Not enough data yet
      </div>
    );
  }
  var W = 320, H = 150, pad = { l: 32, r: 8, t: 10, b: 22 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var vals = allPoints.map(function(p) { return p.val; });
  var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
  var vRange = vMax - vMin || Math.max(Math.abs(vMax) * 0.1, 1);
  vMin = vMin - vRange * 0.1; vMax = vMax + vRange * 0.1; vRange = vMax - vMin || 1;
  var dates = allPoints.map(function(p) { return new Date(p.date).getTime(); });
  var tMin = Math.min.apply(null, dates), tMax = Math.max.apply(null, dates), tRange = tMax - tMin || 1;
  function xMS(t) { return pad.l + ((t - tMin) / tRange) * iw; }
  function yMS(val) { return pad.t + (1 - (val - vMin) / vRange) * ih; }
  var markerX = null;
  if (props.markerDate) { var mt2 = new Date(props.markerDate).getTime(); if (mt2 >= tMin && mt2 <= tMax) markerX = xMS(mt2); }
  return (
    <svg
      viewBox={"0 0 " + W + " " + H}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map(function(t, i) {
        var gv = vMin + vRange * (1 - t);
        return (
          <g key={"g" + i}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={pad.t + ih * t}
              y2={pad.t + ih * t}
              stroke={C.bdr}
              strokeWidth={1}
              strokeDasharray="2,3" />
            <text
              x={pad.l - 4}
              y={pad.t + ih * t + 3}
              fill={C.mut}
              fontSize={9}
              textAnchor="end">
              {gv >= 100 ? gv.toFixed(0) : gv.toFixed(1)}
            </text>
          </g>
        );
      })}
      {markerX != null ? <line
        x1={markerX}
        x2={markerX}
        y1={pad.t}
        y2={pad.t + ih}
        stroke={C.pur}
        strokeWidth={1}
        strokeDasharray="3,3"
        opacity={0.7} /> : null}
      {series.map(function(s, si) {
        var pts = (s.points || []).filter(function(p) { return p.val != null && !isNaN(p.val); });
        if (pts.length < 2) return null;
        var d2 = pts.map(function(p, i) { var px = xMS(new Date(p.date).getTime()), py = yMS(p.val); return (i === 0 ? "M" : "L") + px.toFixed(1) + "," + py.toFixed(1); }).join("");
        return (
          <g key={"s" + si}>
            <path
              d={d2}
              fill="none"
              stroke={s.color || C.blu}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={s.opacity == null ? 1 : s.opacity} />
            {s.showPoints !== false ? pts.map(function(p, i) { var px = xMS(new Date(p.date).getTime()), py = yMS(p.val); return (
              <circle
                key={i}
                cx={px}
                cy={py}
                r={2.5}
                fill={s.color || C.blu}
                stroke={C.bg}
                strokeWidth={0.6} />
            ); }) : null}
          </g>
        );
      })}
      <text x={pad.l} y={H - 6} fill={C.mut} fontSize={9} textAnchor="start">
        {fmtShortDate(allPoints[0].date)}
      </text>
      <text x={W - pad.r} y={H - 6} fill={C.mut} fontSize={9} textAnchor="end">
        {fmtShortDate(allPoints[allPoints.length - 1].date)}
      </text>
    </svg>
  );
}
function BodyCompView() {
  var s1 = React.useState([]); var rawReadings = s1[0]; var setRawReadings = s1[1];
  var s2 = React.useState(true); var loading = s2[0]; var setLoading = s2[1];
  var s3 = React.useState(null); var detailIdx = s3[0]; var setDetailIdx = s3[1];
  React.useEffect(function() {
    db.getHealthDaily(800).then(function(d) { var filtered = (d || []).filter(function(h) { return h.weight_kg != null || h.body_fat_pct != null; }); setRawReadings(filtered); setLoading(false); }).catch(function() { setLoading(false); });
  }, []);
  if (loading) return (
    <div style={{ padding: 32, textAlign: "center", color: C.mut }}>
      Loading…
    </div>
  );
  if (!rawReadings.length) return (
    <div style={{ padding: 32, textAlign: "center", color: C.mut }}>
      No body comp readings yet.
    </div>
  );
  var asc = rawReadings.slice().sort(function(a, b) { return a.date < b.date ? -1 : 1; }).map(deriveBodyComp);
  var L = asc[asc.length - 1];
  if (detailIdx != null) {
    return (
      <ReadingDetailView
        cur={asc[detailIdx]}
        prev={detailIdx > 0 ? asc[detailIdx - 1] : null}
        onBack={function() { setDetailIdx(null); }} />
    );
  }
  function findOnOrBefore(targetDate) {
    for (var i = asc.length - 1; i >= 0; i--) { if (asc[i].date <= targetDate) return asc[i]; }
    return null;
  }
  function dateNDaysBefore(refDate, n) {
    var d = new Date(refDate + "T12:00:00"); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
  }
  var ref7 = findOnOrBefore(dateNDaysBefore(L.date, 7));
  var ref28 = findOnOrBefore(dateNDaysBefore(L.date, 28));
  var peak = asc.reduce(function(m, r) { return (r.weight != null && (m == null || r.weight > m.weight)) ? r : m; }, null);
  var sinceMeso = asc.find(function(r) { return r.date >= META_MESO_START; }) || null;
  function mini(label, val, color) {
    return (
      <div style={{ background: C.c2, borderRadius: 8, padding: "6px 8px" }}>
        <div
          style={{ color: C.mut, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </div>
        <div
          style={{ color: color || C.txt, fontSize: 14, fontWeight: 700, marginTop: 2 }}>
          {val}
        </div>
      </div>
    );
  }
  function rocCard(title, ref) {
    if (!ref) {
      return (
        <div
          style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10 }}>
          <div
            style={{ color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {title}
          </div>
          <div style={{ color: C.mut, fontSize: 12, marginTop: 6 }}>
            No reference reading
          </div>
        </div>
      );
    }
    var dW = L.weight != null && ref.weight != null ? (L.weight - ref.weight) : null;
    var dBF = L.bf != null && ref.bf != null ? (L.bf - ref.bf) : null;
    var dLean = L.lean != null && ref.lean != null ? (L.lean - ref.lean) : null;
    var dFat = L.fat != null && ref.fat != null ? (L.fat - ref.fat) : null;
    var days = daysBetween(ref.date, L.date);
    var leanColor = dLean == null ? C.mut : (dLean >= 0 ? C.grn : C.red);
    var fatColor = dFat == null ? C.mut : (dFat <= 0 ? C.grn : C.red);
    var wColor = dW == null ? C.mut : (dW < 0 ? C.grn : C.red);
    return (
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div
            style={{ color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {title}
          </div>
          <div style={{ color: C.mut, fontSize: 9 }}>
            {days + "d · " + fmtShortDate(ref.date)}
          </div>
        </div>
        <div
          style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
          <div>
            <div style={{ color: C.mut, fontSize: 9 }}>
              Weight
            </div>
            <div style={{ color: wColor, fontSize: 13, fontWeight: 700 }}>
              {fmtSignedNum(dW, 1) + " lb"}
            </div>
          </div>
          <div>
            <div style={{ color: C.mut, fontSize: 9 }}>
              BF%
            </div>
            <div
              style={{ color: dBF == null ? C.mut : (dBF <= 0 ? C.grn : C.red), fontSize: 13, fontWeight: 700 }}>
              {fmtSignedNum(dBF, 1) + "%"}
            </div>
          </div>
          <div>
            <div style={{ color: C.mut, fontSize: 9 }}>
              Lean
            </div>
            <div style={{ color: leanColor, fontSize: 13, fontWeight: 700 }}>
              {fmtSignedNum(dLean, 1) + " lb"}
            </div>
          </div>
          <div>
            <div style={{ color: C.mut, fontSize: 9 }}>
              Fat
            </div>
            <div style={{ color: fatColor, fontSize: 13, fontWeight: 700 }}>
              {fmtSignedNum(dFat, 1) + " lb"}
            </div>
          </div>
        </div>
      </div>
    );
  }
  function chartBlock(title, key, color, unit) {
    var pts = asc.map(function(r) { return { date: r.date, val: r[key] }; });
    return (
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
            {title}
          </div>
          <div style={{ color: color, fontSize: 13, fontWeight: 700 }}>
            {L[key] != null ? L[key].toFixed(unit === "%" ? 1 : 1) + (unit ? " " + unit : "") : "—"}
          </div>
        </div>
        <TrendChart
          data={pts}
          color={color}
          unit={unit}
          markerDate={META_MESO_START}
          onTap={function(d) { var idx = asc.findIndex(function(r) { return r.date === d.date; }); if (idx >= 0) setDetailIdx(idx); }} />
      </div>
    );
  }
  return (
    <div>
      <div
        style={{ background: C.card, borderRadius: 12, padding: 14, border: "1px solid " + C.bdr, marginBottom: 8, cursor: "pointer" }}
        onClick={function() { setDetailIdx(asc.length - 1); }}>
        <div
          style={{ color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
          {"Latest · " + fmtShortDate(L.date)}
        </div>
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
          <div style={{ color: C.txt, fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
            {L.weight != null ? L.weight.toFixed(1) : "—"}
          </div>
          <div style={{ color: C.mut, fontSize: 13 }}>
            lb
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {mini("BF%", L.bf != null ? L.bf.toFixed(1) + "%" : "—", C.gld)}
          {mini("Lean", L.lean != null ? L.lean.toFixed(1) + " lb" : "—", C.grn)}
          {mini("Fat", L.fat != null ? L.fat.toFixed(1) + " lb" : "—", C.red)}
        </div>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        {rocCard("7-Day", ref7)}
        {rocCard("28-Day", ref28)}
        {rocCard("From Peak", peak)}
        {rocCard("Since Meso 1", sinceMeso)}
      </div>
      {chartBlock("Weight", "weight", C.blu, "lb")}
      {chartBlock("Body Fat", "bf", C.gld, "%")}
      {chartBlock("Lean Mass", "lean", C.grn, "lb")}
      {chartBlock("Fat Mass", "fat", C.red, "lb")}
      <div
        style={{ color: C.mut, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 8 }}>
        {"All Readings (" + asc.length + ")"}
      </div>
      {asc.slice().reverse().map(function(r, i) {
        var origIdx = asc.length - 1 - i;
        return (
          <div
            key={r.date}
            onClick={function() { setDetailIdx(origIdx); }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 6px", borderBottom: "1px solid " + C.bdr, cursor: "pointer" }}>
            <div>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>
                {fmtShortDate(r.date)}
              </div>
              {r.bf != null ? <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                {r.bf.toFixed(1) + "% BF" + (r.lean != null ? " · " + r.lean.toFixed(1) + " lean" : "")}
              </div> : null}
            </div>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 700 }}>
              {r.weight != null ? r.weight.toFixed(1) + " lb" : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function ReadingDetailView(props) {
  var cur = props.cur, prev = props.prev;
  function delta(curV, prevV) { if (curV == null || prevV == null) return null; return curV - prevV; }
  function row(label, curV, prevV, unit, dp, betterDir) {
    var d = delta(curV, prevV), color = C.mut, dp1 = dp == null ? 1 : dp;
    if (d != null && Math.abs(d) > 0.001) {
      var good = betterDir === "up" ? d > 0 : (betterDir === "down" ? d < 0 : false);
      color = good ? C.grn : (betterDir ? C.red : C.mut);
    }
    return (
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid " + C.bdr }}>
        <div
          style={{ color: C.mut, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, paddingTop: 2 }}>
          {label}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: C.txt, fontSize: 15, fontWeight: 700 }}>
            {curV != null ? curV.toFixed(dp1) + (unit ? " " + unit : "") : "—"}
          </div>
          {d != null ? <div style={{ color: color, fontSize: 11, marginTop: 2 }}>
            {fmtSignedNum(d, dp1) + (unit ? " " + unit : "") + (prev ? " vs " + fmtShortDate(prev.date) : "")}
          </div> : null}
        </div>
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={props.onBack}
        style={{ background: "transparent", border: "1px solid " + C.bdr, color: C.mut, fontSize: 12, borderRadius: 8, padding: "6px 14px", marginBottom: 10, cursor: "pointer" }}>
        ← Back
      </button>
      <div
        style={{ background: C.card, borderRadius: 12, padding: 14, border: "1px solid " + C.bdr }}>
        <div
          style={{ color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          {fmtShortDate(cur.date)}
        </div>
        {row("Weight", cur.weight, prev ? prev.weight : null, "lb", 1, "down")}
        {row("Body Fat", cur.bf, prev ? prev.bf : null, "%", 1, "down")}
        {row("Lean Mass", cur.lean, prev ? prev.lean : null, "lb", 1, "up")}
        {row("Fat Mass", cur.fat, prev ? prev.fat : null, "lb", 1, "down")}
        {cur.raw && cur.raw.resting_hr != null ? row("Resting HR", parseFloat(cur.raw.resting_hr), prev && prev.raw && prev.raw.resting_hr != null ? parseFloat(prev.raw.resting_hr) : null, "bpm", 0, "down") : null}
        {cur.raw && cur.raw.waist_inches != null ? row("Waist", parseFloat(cur.raw.waist_inches), prev && prev.raw && prev.raw.waist_inches != null ? parseFloat(prev.raw.waist_inches) : null, "in", 1, "down") : null}
        {cur.raw && cur.raw.notes ? <div style={{ marginTop: 10, color: C.mut, fontSize: 12 }}>
          {cur.raw.notes}
        </div> : null}
      </div>
    </div>
  );
}
function SparkLine(props) {
  var data = (props.data || []).filter(function(d) { return d != null && d.val != null; });
  var full = props.full, w = props.width || 80, h = props.height || 30, color = props.color || C.blu;
  if (data.length < 2) return <div style={{ width: full ? "100%" : w, height: h }} />;
  var vals = data.map(function(d) { return d.val; });
  var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), rng = mx - mn || 1;
  var vw = 100, pts = data.map(function(d, i) { return ((i / (data.length - 1)) * (vw - 4) + 2).toFixed(1) + "," + (h - 2 - ((d.val - mn) / rng) * (h - 6)).toFixed(1); });
  if (full) {
    return (
      <svg viewBox={"0 0 " + vw + " " + h} preserveAspectRatio="none" width="100%" height={h} style={{ display: "block", marginTop: 6 }}>
        <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }
  var fixPts = data.map(function(d, i) { return ((i / (data.length - 1)) * (w - 4) + 2).toFixed(1) + "," + (h - 2 - ((d.val - mn) / rng) * (h - 6)).toFixed(1); });
  return (
    <svg width={w} height={h} style={{ display: "block", marginTop: 6 }}>
      <polyline points={fixPts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function BackBtn(props) {
  return (
    <button
      onClick={props.onClick}
      style={{ background: "transparent", border: "1px solid " + C.bdr, color: C.mut, fontSize: 12, borderRadius: 8, padding: "6px 14px", marginBottom: 12, cursor: "pointer" }}>
      ← Back
    </button>
  );
}
function SessionDetailView(props) {
  var session = props.session, allSets = props.allSets;
  var sSets = allSets.filter(function(s) { return s.sessionId === session.id; }).sort(function(a, b) { return (a.set_number || 0) - (b.set_number || 0); });
  var exOrder = [], byEx = {};
  sSets.forEach(function(s) { if (!byEx[s.exId]) { byEx[s.exId] = { name: s.exName, sets: [] }; exOrder.push(s.exId); } byEx[s.exId].sets.push(s); });
  var totalVol = sSets.reduce(function(sm, s) { return sm + s.weight * s.reps; }, 0);
  return (
    <div>
      <BackBtn onClick={props.onBack} />
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ color: C.txt, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
          {session.notes || fmtShortDate(session.date)}
        </div>
        <div style={{ color: C.mut, fontSize: 11, marginBottom: 10 }}>
          {fmtShortDate(session.date) + (session.week_number != null ? " \u00b7 W" + session.week_number : "") + (session.rir != null ? " \u00b7 " + session.rir + " RIR" : "")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div style={{ background: C.c2, borderRadius: 8, padding: "6px 8px" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Exercises
            </div>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 700, marginTop: 2 }}>
              {exOrder.length}
            </div>
          </div>
          <div style={{ background: C.c2, borderRadius: 8, padding: "6px 8px" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Sets
            </div>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 700, marginTop: 2 }}>
              {sSets.length}
            </div>
          </div>
          <div style={{ background: C.c2, borderRadius: 8, padding: "6px 8px" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Volume
            </div>
            <div style={{ color: C.gld, fontSize: 15, fontWeight: 700, marginTop: 2 }}>
              {(totalVol / 1000).toFixed(1) + "k"}
            </div>
          </div>
        </div>
      </div>
      {exOrder.map(function(exId) {
        var ex = byEx[exId];
        return (
          <div
            key={exId}
            style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ color: C.txt, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              {ex.name}
            </div>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: C.mut, borderBottom: "1px solid " + C.bdr }}>
                  <th style={{ padding: "3px 6px", textAlign: "center", fontWeight: 600 }}>
                    #
                  </th>
                  <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600 }}>
                    Weight
                  </th>
                  <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600 }}>
                    Reps
                  </th>
                  <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600 }}>
                    e1RM
                  </th>
                </tr>
              </thead>
              <tbody>
                {ex.sets.map(function(s, si) {
                  var e1rm = s.weight * (1 + s.reps / 30);
                  return (
                    <tr key={si} style={{ borderBottom: "1px solid " + C.bdr }}>
                      <td style={{ padding: "5px 6px", textAlign: "center", color: C.mut }}>
                        {si + 1}
                      </td>
                      <td
                        style={{ padding: "5px 6px", textAlign: "right", color: C.txt, fontWeight: 600 }}>
                        {s.weight + " lb"}
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "right", color: C.grn }}>
                        {s.reps}
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "right", color: C.mut }}>
                        {e1rm.toFixed(0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
function MuscleGroupDetailView(props) {
  var mg = props.mg, allSets = props.allSets, lmByMG = props.lmByMG;
  var lm = lmByMG[mg] || null;
  var mgSets = allSets.filter(function(s) { return s.muscleGroup === mg; });
  var weekKeys = [], weekCounts = {};
  mgSets.forEach(function(s) {
    if (s.week == null) return;
    var key = (s.mesoNote ? s.mesoNote.replace("Meso ", "M") : "?") + "-W" + s.week;
    if (!weekCounts[key]) { weekCounts[key] = 0; weekKeys.push(key); }
    weekCounts[key]++;
  });
  var wData = weekKeys.map(function(k) {
    var v = weekCounts[k], col = C.mut;
    if (lm) { if (v < (lm.mev_sets || 0)) col = C.red; else if (v <= (lm.mav_sets || 99)) col = C.grn; else if (v <= (lm.mrv_sets || 99)) col = C.gld; else col = C.red; }
    return { label: k, val: v, color: col, unit: " sets" };
  });
  var exMap = {}, exNames = [];
  mgSets.forEach(function(s) {
    if (!exMap[s.exName]) { exMap[s.exName] = { topE1rm: 0, count: 0 }; exNames.push(s.exName); }
    var e1rm = s.weight * (1 + s.reps / 30);
    if (e1rm > exMap[s.exName].topE1rm) exMap[s.exName].topE1rm = e1rm;
    exMap[s.exName].count++;
  });
  exNames = exNames.sort(function(a, b) { return exMap[b].topE1rm - exMap[a].topE1rm; });
  function mini(label, val, color) {
    return (
      <div style={{ background: C.c2, borderRadius: 8, padding: "6px 8px" }}>
        <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
          {label}
        </div>
        <div
          style={{ color: color || C.txt, fontSize: 14, fontWeight: 700, marginTop: 2 }}>
          {val != null ? String(val) : "\u2014"}
        </div>
      </div>
    );
  }
  return (
    <div>
      <BackBtn onClick={props.onBack} />
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div
          style={{ color: C.txt, fontSize: 16, fontWeight: 800, marginBottom: lm ? 10 : 0 }}>
          {mg}
        </div>
        {lm ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {mini("MEV", lm.mev_sets, C.red)}
          {mini("MAV", lm.mav_sets, C.grn)}
          {mini("MRV", lm.mrv_sets, C.gld)}
        </div> : null}
      </div>
      {wData.length ? <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
            Sets per Week
          </div>
          {(function() {
            if (wData.length < 2) return null;
            var trend = wData[wData.length - 1].val - wData[0].val;
            var label = trend > 0 ? "↑ Progressing" : trend < 0 ? "↓ Tapering" : "→ Stable";
            var color = trend > 0 ? C.grn : trend < 0 ? C.gld : C.mut;
            return (
              <div style={{ color: color, fontSize: 10, fontWeight: 700 }}>
                {label}
              </div>
            );
          })()}
        </div>
        <BarsChart data={wData} />
      </div> : null}
      {exNames.length ? <div>
        <div
          style={{ color: C.mut, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          {"Exercises (" + exNames.length + ")"}
        </div>
        {exNames.map(function(n) {
          var ex = exMap[n];
          return (
            <div
              key={n}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 6px", borderBottom: "1px solid " + C.bdr }}>
              <div style={{ color: C.txt, fontSize: 12, fontWeight: 600 }}>
                {n}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.blu, fontSize: 12, fontWeight: 700 }}>
                  {ex.topE1rm.toFixed(0) + " lb e1RM"}
                </div>
                <div style={{ color: C.mut, fontSize: 10 }}>
                  {ex.count + " sets"}
                </div>
              </div>
            </div>
          );
        })}
      </div> : null}
    </div>
  );
}
function ExerciseDetailView(props) {
  var exName = props.exName, allSets = props.allSets, sessById = props.sessById;
  var exSets = allSets.filter(function(s) { return s.exName === exName; });
  var bySession = {};
  exSets.forEach(function(s) {
    if (!bySession[s.sessionId]) bySession[s.sessionId] = { date: s.date, mesoNote: s.mesoNote, week: s.week, sets: [] };
    bySession[s.sessionId].sets.push(s);
  });
  var sessionTops = Object.keys(bySession).map(function(sid) {
    var b = bySession[sid];
    var top = b.sets.reduce(function(m, s) { var e1rm = s.weight * (1 + s.reps / 30); return (m == null || e1rm > m.e1rm) ? { weight: s.weight, reps: s.reps, e1rm: e1rm } : m; }, null);
    return { sessionId: sid, date: b.date, mesoNote: b.mesoNote, week: b.week, top: top, setCount: b.sets.length };
  }).sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  var mesoColors = [C.blu, C.gld, C.grn, C.red, C.pur, C.org, C.teal];
  var mesoNoteOrder = ["Meso 0","Meso 1","Meso 2","Meso 3","Meso 4","Meso 5"];
  var mesoColor = function(mid) { var i = mesoNoteOrder.indexOf(mid); return i < 0 ? C.mut : mesoColors[i % mesoColors.length]; };
  var seriesByMeso = {};
  sessionTops.forEach(function(st) {
    var mid = st.mesoNote || "none";
    if (!seriesByMeso[mid]) seriesByMeso[mid] = { points: [] };
    seriesByMeso[mid].points.push({ date: st.date, val: +st.top.e1rm.toFixed(1) });
  });
  var strengthSeries = Object.keys(seriesByMeso).map(function(mid) { return { label: mid === "none" ? "Other" : mid, color: mesoColor(mid), points: seriesByMeso[mid].points }; });
  var volSeries = sessionTops.map(function(st) { return { date: st.date, val: st.setCount }; });
  var latest = sessionTops.length ? sessionTops[sessionTops.length - 1] : null;
  var first = sessionTops.length ? sessionTops[0] : null;
  var pct = first && latest && first.top.e1rm > 0 ? Math.round((latest.top.e1rm / first.top.e1rm - 1) * 100) : 0;
  var bestSet = exSets.reduce(function(m, s) { return (m == null || s.weight > m.weight || (s.weight === m.weight && s.reps > m.reps)) ? s : m; }, null);
  var avgSets = sessionTops.length ? (exSets.length / sessionTops.length).toFixed(1) : "—";
  return (
    <div>
      <BackBtn onClick={props.onBack} />
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ color: C.txt, fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
          {exName}
        </div>
        {latest ? <div
          style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
          <div style={{ color: C.blu, fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
            {latest.top.e1rm.toFixed(0)}
          </div>
          <div style={{ color: C.mut, fontSize: 13 }}>
            lb e1RM
          </div>
          {pct !== 0 ? <div style={{ color: pct > 0 ? C.grn : C.red, fontSize: 16, fontWeight: 700 }}>
            {(pct > 0 ? "+" : "") + pct + "%"}
          </div> : null}
        </div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          <div
            style={{ background: C.c2, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Sessions
            </div>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 700 }}>
              {sessionTops.length}
            </div>
          </div>
          <div
            style={{ background: C.c2, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Total Sets
            </div>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 700 }}>
              {exSets.length}
            </div>
          </div>
          <div
            style={{ background: C.c2, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Avg/Sess
            </div>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 700 }}>
              {avgSets}
            </div>
          </div>
        </div>
        {bestSet ? <div
          style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{ color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Best Set
          </div>
          <div style={{ color: C.gld, fontSize: 12, fontWeight: 700 }}>
            {bestSet.weight + " lb × " + bestSet.reps + " · " + fmtShortDate(bestSet.date)}
          </div>
        </div> : null}
      </div>
      {strengthSeries.length ? <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 }}>
        <div style={{ color: C.txt, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          e1RM Trend
        </div>
        <MultiSeriesChart series={strengthSeries} markerDate={META_MESO_START} />
        {strengthSeries.length > 1 ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          {strengthSeries.map(function(s, i) { return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 2, background: s.color, borderRadius: 1 }} />
              <div style={{ color: C.mut, fontSize: 10 }}>
                {s.label}
              </div>
            </div>
          ); })}
        </div> : null}
      </div> : null}
      {volSeries.length > 1 ? <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 }}>
        <div style={{ color: C.txt, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          Sets per Session
        </div>
        <TrendChart data={volSeries} color={C.pur} unit=" sets" markerDate={META_MESO_START} />
      </div> : null}
      <div
        style={{ color: C.mut, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 4 }}>
        {"Sessions (" + sessionTops.length + ")"}
      </div>
      {sessionTops.slice().reverse().map(function(st, i) {
        var sess = sessById[st.sessionId];
        return (
          <div
            key={i}
            onClick={sess ? function() { props.onSession(sess); } : undefined}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 6px", borderBottom: "1px solid " + C.bdr, cursor: sess ? "pointer" : "default" }}>
            <div>
              <div style={{ color: C.txt, fontSize: 12, fontWeight: 600 }}>
                {fmtShortDate(st.date)}
              </div>
              <div style={{ color: C.mut, fontSize: 10 }}>
                {(st.mesoNote || "—") + (st.week != null ? " · W" + st.week : "") + " · " + st.setCount + " sets"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>
                  {st.top.weight + " × " + st.top.reps}
                </div>
                <div style={{ color: mesoColor(st.mesoNote), fontSize: 10 }}>
                  {"e1RM " + st.top.e1rm.toFixed(0)}
                </div>
              </div>
              {sess ? <div style={{ color: C.mut, fontSize: 14 }}>
                ›
              </div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function PerformanceView() {
  var s1 = React.useState(null); var loaded = s1[0]; var setLoaded = s1[1];
  var s2 = React.useState([]); var navStack = s2[0]; var setNavStack = s2[1];
  var s3 = React.useState(null); var expandedEx = s3[0]; var setExpandedEx = s3[1];
  React.useEffect(function() {
    Promise.all([db.getRecentSessions(1000), db.getVolumeLandmarks()])
      .then(function(arr) { setLoaded({ sessions: arr[0] || [], landmarks: arr[1] || [] }); })
      .catch(function() { setLoaded({ sessions: [], landmarks: [] }); });
  }, []);
  if (!loaded) return (
    <div style={{ padding: 32, textAlign: "center", color: C.mut }}>
      Loading…
    </div>
  );
  var sessions = loaded.sessions, landmarks = loaded.landmarks;
  if (sessions.length === 0) return (
    <div style={{ padding: 32, textAlign: "center", color: C.mut }}>
      No sessions logged yet.
    </div>
  );
  var sessById = {}; sessions.forEach(function(s) { sessById[s.id] = s; });
  var lmByMG = {}; landmarks.forEach(function(l) { lmByMG[l.muscle_group] = l; });
  var annotatedSets = [];
  sessions.forEach(function(sess) {
    var mesoNote = ((sess.notes || "").match(/^(Meso \d+)/) || [])[1] || null;
    (sess.sets || []).forEach(function(st) {
      var e = st.exercises || {};
      annotatedSets.push({ id: st.id, reps: st.reps, weight: parseFloat(st.weight) || 0, set_number: st.set_number, date: sess.date, sessionId: sess.id, mesoNote: mesoNote, week: sess.week_number, exId: st.exercise_id, exName: e.name || "Unknown", muscleGroup: e.muscle_group || null, cableRatio: parseFloat(e.cable_ratio) || 1 });
    });
  });
  function push(page) { setNavStack(navStack.concat([page])); }
  function pop() { setNavStack(navStack.slice(0, -1)); }
  var cur = navStack.length ? navStack[navStack.length - 1] : null;
  if (cur && cur.type === "session") return <SessionDetailView session={cur.session} allSets={annotatedSets} onBack={pop} />;
  if (cur && cur.type === "mg") return <MuscleGroupDetailView mg={cur.mg} allSets={annotatedSets} lmByMG={lmByMG} onBack={pop} />;
  if (cur && cur.type === "exercise") return (
    <ExerciseDetailView
      exName={cur.exName}
      allSets={annotatedSets}
      sessById={sessById}
      onBack={pop}
      onSession={function(sess) { push({ type: "session", session: sess }); }} />
  );
  var lastSession = sessions.filter(function(s) { return (s.sets || []).length > 0; }).sort(function(a, b) { return a.date < b.date ? 1 : -1; })[0];
  var curWeek = lastSession ? lastSession.week_number : null;
  var curMesoNote = lastSession ? ((lastSession.notes || "").match(/^(Meso \d+)/) || [])[1] || null : null;
  var curMesoSessions = sessions.filter(function(s) { return (s.sets || []).length > 0 && curMesoNote && ((s.notes || "").match(/^(Meso \d+)/) || [])[1] === curMesoNote; });
  var curMesoSets = annotatedSets.filter(function(s) { return curMesoNote && s.mesoNote === curMesoNote; });
  var curMesoVolume = curMesoSets.reduce(function(sm, s) { return sm + (s.weight / (s.cableRatio || 1)) * s.reps; }, 0);
  var curMesoEx = (function() { var ex = {}; curMesoSets.forEach(function(s) { ex[s.exName] = true; }); return Object.keys(ex).length; })();
  var weekSets = annotatedSets.filter(function(s) { return curWeek != null && s.week === curWeek && s.mesoNote === curMesoNote; });
  var volByMG = {};
  weekSets.forEach(function(s) { if (!s.muscleGroup) return; volByMG[s.muscleGroup] = (volByMG[s.muscleGroup] || 0) + 1; });
  var allMGKeys = (function() { var k = {}; Object.keys(lmByMG).forEach(function(m) { k[m] = true; }); weekSets.forEach(function(s) { if (s.muscleGroup) k[s.muscleGroup] = true; }); return Object.keys(k).sort(); })();
  var mgPills = allMGKeys.map(function(mg) {
    var lm = lmByMG[mg], v = volByMG[mg] || 0;
    var color = v === 0 ? C.mut : (!lm ? C.blu : v < (lm.mev_sets || 0) ? C.red : v <= (lm.mav_sets || 99) ? C.grn : v <= (lm.mrv_sets || 99) ? C.gld : C.red);
    return { label: mg, val: v, color: color };
  }).filter(function(p) { return p.val > 0; });
  var exSessMap = {};
  annotatedSets.forEach(function(s) {
    if (!exSessMap[s.exName]) exSessMap[s.exName] = { mg: s.muscleGroup, sessions: {} };
    if (s.muscleGroup && !exSessMap[s.exName].mg) exSessMap[s.exName].mg = s.muscleGroup;
    if (!exSessMap[s.exName].sessions[s.sessionId]) exSessMap[s.exName].sessions[s.sessionId] = { date: s.date, topE1rm: 0 };
    var e1rm = s.weight * (1 + s.reps / 30);
    if (e1rm > exSessMap[s.exName].sessions[s.sessionId].topE1rm) exSessMap[s.exName].sessions[s.sessionId].topE1rm = e1rm;
  });
  var topLifts = Object.keys(exSessMap).map(function(n) {
    var ex = exSessMap[n];
    var arr = Object.keys(ex.sessions).map(function(k) { return ex.sessions[k]; }).sort(function(a, b) { return a.date < b.date ? -1 : 1; });
    var first = arr[0], last = arr[arr.length - 1];
    var pct = first && first.topE1rm > 0 ? Math.round((last.topE1rm / first.topE1rm - 1) * 100) : 0;
    return { name: n, mg: ex.mg, e1rm: last.topE1rm, lastDate: last.date, pct: pct, spark: arr.map(function(s) { return { val: +s.topE1rm.toFixed(0) }; }) };
  }).sort(function(a, b) { return a.lastDate < b.lastDate ? 1 : -1; });
  var liftsByMG = {};
  topLifts.forEach(function(l) { var k = l.mg || "Other"; if (!liftsByMG[k]) liftsByMG[k] = []; liftsByMG[k].push(l); });
  var liftMGKeys = allMGKeys.filter(function(mg) { return liftsByMG[mg]; }).concat(liftsByMG["Other"] ? ["Other"] : []);
  var mesoWeeksElapsed = curWeek || 1;
  var mesoVolByMG = {};
  curMesoSets.forEach(function(s) { if (!s.muscleGroup) return; mesoVolByMG[s.muscleGroup] = (mesoVolByMG[s.muscleGroup] || 0) + 1; });
  var volBars = allMGKeys.map(function(mg) {
    var lm = lmByMG[mg], total = mesoVolByMG[mg] || 0, v = Math.round(total / mesoWeeksElapsed), color = C.mut;
    if (lm) { if (v < (lm.mev_sets || 0)) color = C.red; else if (v <= (lm.mav_sets || 99)) color = C.grn; else if (v <= (lm.mrv_sets || 99)) color = C.gld; else color = C.red; }
    return { label: mg, val: v, color: color, unit: " sets/wk" };
  }).filter(function(b) { return b.val > 0 || lmByMG[b.label]; });
  var recentSessions = sessions.filter(function(s) { return (s.sets || []).length > 0; }).sort(function(a, b) { return a.date < b.date ? 1 : -1; });
  return (
    <div>
      {curMesoNote ? <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ color: C.txt, fontSize: 16, fontWeight: 800 }}>
              {curMesoNote}
            </div>
            {curWeek != null ? <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
              {"Week " + curWeek}
            </div> : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.gld, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>
              {(curMesoVolume / 1000).toFixed(1) + "k"}
            </div>
            <div style={{ color: C.mut, fontSize: 9, marginTop: 2 }}>
              true volume
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          <div
            style={{ background: C.c2, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Sessions
            </div>
            <div style={{ color: C.txt, fontSize: 17, fontWeight: 700 }}>
              {curMesoSessions.length}
            </div>
          </div>
          <div
            style={{ background: C.c2, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Sets
            </div>
            <div style={{ color: C.txt, fontSize: 17, fontWeight: 700 }}>
              {curMesoSets.length}
            </div>
          </div>
          <div
            style={{ background: C.c2, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ color: C.mut, fontSize: 9, textTransform: "uppercase" }}>
              Exercises
            </div>
            <div style={{ color: C.txt, fontSize: 17, fontWeight: 700 }}>
              {curMesoEx}
            </div>
          </div>
        </div>
      </div> : null}
      {mgPills.length ? <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
            This Week
          </div>
          <div style={{ color: C.mut, fontSize: 10 }}>
            {curWeek != null ? "W" + curWeek + (curMesoNote ? " · " + curMesoNote : "") : "—"}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {mgPills.map(function(mg) {
            return (
              <div
                key={mg.label}
                onClick={function() { push({ type: "mg", mg: mg.label }); }}
                style={{ background: mg.color + "1a", border: "1px solid " + mg.color + "55", borderRadius: 20, padding: "4px 10px", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <span style={{ color: mg.color, fontSize: 13, fontWeight: 800 }}>
                  {mg.val}
                </span>
                <span style={{ color: C.mut, fontSize: 10 }}>
                  {mg.label}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.red }} />
            <span style={{ color: C.mut, fontSize: 9 }}>
              &lt; MEV
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.grn }} />
            <span style={{ color: C.mut, fontSize: 9 }}>
              MEV–MAV
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.gld }} />
            <span style={{ color: C.mut, fontSize: 9 }}>
              MAV–MRV
            </span>
          </div>
        </div>
      </div> : null}
      {liftMGKeys.length ? <div style={{ marginBottom: 10 }}>
        <div style={{ color: C.mut, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          Strength Progress
        </div>
        {liftMGKeys.map(function(mg) {
          var exList = liftsByMG[mg];
          var canDrill = mg !== "Other" && lmByMG[mg];
          return (
            <div key={mg} style={{ marginBottom: 12 }}>
              <div
                onClick={canDrill ? function() { push({ type: "mg", mg: mg }); } : undefined}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5, cursor: canDrill ? "pointer" : "default" }}>
                <div style={{ color: canDrill ? C.txt : C.mut, fontSize: 11, fontWeight: 700 }}>{mg}</div>
                {canDrill ? <div style={{ color: C.mut, fontSize: 12 }}>›</div> : null}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {exList.map(function(l) {
                  var sc = l.pct >= 0 ? C.grn : C.red;
                  var isExpanded = expandedEx === l.name;
                  if (isExpanded) {
                    return (
                      <div key={l.name} style={{ gridColumn: "1 / -1", background: C.card, border: "1px solid " + C.blu + "55", borderRadius: 10, padding: "10px 10px 8px", cursor: "pointer" }}
                        onClick={function() { setExpandedEx(null); }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ color: C.txt, fontSize: 11, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {l.name}
                          </div>
                          <div style={{ color: C.mut, fontSize: 10, marginLeft: 8, flexShrink: 0 }}>▾ collapse</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                          <span style={{ color: C.blu, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{l.e1rm.toFixed(0)}</span>
                          <span style={{ color: C.mut, fontSize: 10 }}>lb e1RM</span>
                          {l.pct !== 0 && <span style={{ color: sc, fontSize: 12, fontWeight: 700 }}>{(l.pct > 0 ? "+" : "") + l.pct + "%"}</span>}
                        </div>
                        <SparkLine data={l.spark} color={sc} full height={28} />
                        <div onClick={function(e) { e.stopPropagation(); push({ type: "exercise", exName: l.name }); }}
                          style={{ marginTop: 8, color: C.blu, fontSize: 11, fontWeight: 700, textAlign: "right" }}>
                          Full detail →
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={l.name} onClick={function() { setExpandedEx(l.name); }}
                      style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 8, padding: "6px 7px", cursor: "pointer", minWidth: 0 }}>
                      <div style={{ color: C.txt, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
                        {l.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ color: C.blu, fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{l.e1rm.toFixed(0)}</span>
                        <span style={{ color: C.mut, fontSize: 9 }}>e1RM</span>
                        {l.pct !== 0 && <span style={{ color: sc, fontSize: 9, fontWeight: 700 }}>{(l.pct > 0 ? "+" : "") + l.pct + "%"}</span>}
                      </div>
                      <SparkLine data={l.spark} color={sc} width={120} height={22} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div> : null}
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
            Avg Sets/Week vs Targets
          </div>
          <div style={{ color: C.mut, fontSize: 10 }}>
            {curMesoNote ? "W1–W" + mesoWeeksElapsed + " avg · tap to drill" : "tap to drill"}
          </div>
        </div>
        <BarsChart data={volBars} onBar={function(d) { push({ type: "mg", mg: d.label }); }} />
      </div>
      <div>
        <div
          style={{ color: C.mut, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          Recent Sessions
        </div>
        {recentSessions.map(function(sess) {
          var sessSets = annotatedSets.filter(function(s) { return s.sessionId === sess.id; });
          var vol = sessSets.reduce(function(sm, s) { return sm + (s.weight / (s.cableRatio || 1)) * s.reps; }, 0);
          var exSeen = {}, exArr = [];
          sessSets.forEach(function(s) { if (!exSeen[s.exName]) { exSeen[s.exName] = true; exArr.push(s.exName); } });
          var sessWeek = sess.week_number;
          return (
            <div
              key={sess.id}
              onClick={function() { push({ type: "session", session: sess }); }}
              style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 6, cursor: "pointer" }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ color: C.txt, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {sess.notes || fmtShortDate(sess.date)}
                  </div>
                  <div style={{ color: C.mut, fontSize: 10, marginTop: 1 }}>
                    {fmtShortDate(sess.date) + (sessWeek != null ? " · W" + sessWeek : "")}
                  </div>
                </div>
                <div style={{ color: C.mut, fontSize: 14, marginLeft: 8 }}>
                  ›
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 7 }}>
                <div>
                  <span style={{ color: C.txt, fontWeight: 700, fontSize: 12 }}>
                    {sessSets.length}
                  </span>
                  <span style={{ color: C.mut, fontSize: 10 }}>
                    {" sets"}
                  </span>
                </div>
                {vol > 0 ? <div>
                  <span style={{ color: C.gld, fontWeight: 700, fontSize: 12 }}>
                    {(vol / 1000).toFixed(1) + "k"}
                  </span>
                  <span style={{ color: C.mut, fontSize: 10 }}>
                    {" vol"}
                  </span>
                </div> : null}
                {exArr.length ? <div
                  style={{ color: C.mut, fontSize: 10, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {exArr.slice(0, 3).join(" ·") + (exArr.length > 3 ? " +" + (exArr.length - 3) : "")}
                </div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function RecoveryView() {
  var s1 = React.useState(null); var loaded = s1[0]; var setLoaded = s1[1];
  React.useEffect(function() {
    Promise.all([db.getHealthDaily(800), db.getAllSessions()]).then(function(arr) { setLoaded({ health: arr[0], sessions: arr[1] || [] }); }).catch(function() { setLoaded({ health: null, sessions: [] }); });
  }, []);
  if (!loaded) return (
    <div style={{ padding: 32, textAlign: "center", color: C.mut }}>
      Loading…
    </div>
  );
  if (loaded.health == null) {
    return (
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 20 }}>
        <div style={{ color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          Health Data Required
        </div>
        <div style={{ color: C.mut, fontSize: 12, lineHeight: 1.4 }}>
          Recovery analytics require the health_daily Supabase table.
          <br />
          <br />
          Run setup_health_daily.sql in the Supabase SQL editor to create the table, then seed it with Apple Health exports.
        </div>
      </div>
    );
  }
  var health = loaded.health;
  if (health.length === 0) {
    return (
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 20 }}>
        <div style={{ color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          No Health Data
        </div>
        <div style={{ color: C.mut, fontSize: 12 }}>
          Seed health_daily with Apple Health exports.
        </div>
      </div>
    );
  }
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 120);
  var cutoffStr = cutoff.toISOString().slice(0, 10);
  var recent = health.filter(function(h) { return h.date >= cutoffStr; });
  var hLast = health[health.length - 1];
  var trainingDays = {}; loaded.sessions.forEach(function(s) { trainingDays[s.date] = true; });
  function statCard(label, key, unit, color, dp, betterDir) {
    var smaArr = smaSeries(recent, function(h) { return h[key] != null ? parseFloat(h[key]) : null; }, 7);
    var latestSma = smaArr.length ? smaArr[smaArr.length - 1].val : null;
    var prevSma = smaArr.length > 7 ? smaArr[smaArr.length - 8].val : null;
    var trend = latestSma != null && prevSma != null ? latestSma - prevSma : null;
    var trendColor = trend == null ? C.mut : (betterDir === "up" ? (trend > 0 ? C.grn : C.red) : (betterDir === "down" ? (trend < 0 ? C.grn : C.red) : C.mut));
    return (
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: "8px 10px" }}>
        <div
          style={{ color: C.mut, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </div>
        <div
          style={{ color: color, fontSize: 20, fontWeight: 800, margin: "4px 0 2px" }}>
          {latestSma != null ? latestSma.toFixed(dp == null ? 0 : dp) : "—"}
          <span style={{ color: C.mut, fontSize: 10, fontWeight: 600, marginLeft: 3 }}>
            {unit}
          </span>
        </div>
        {trend != null ? <div style={{ color: trendColor, fontSize: 10, fontWeight: 600 }}>
          {fmtSignedNum(trend, dp == null ? 0 : dp) + " 7d"}
        </div> : null}
      </div>
    );
  }
  function makeSeries(key, color) {
    var raw = recent.map(function(h) { return { date: h.date, val: h[key] != null ? parseFloat(h[key]) : null }; });
    var sma = smaSeries(recent, function(h) { return h[key] != null ? parseFloat(h[key]) : null; }, 7);
    return [{ label: "raw", color: color, points: raw, opacity: 0.35, showPoints: false }, { label: "7d avg", color: color, points: sma, opacity: 1, showPoints: false }];
  }
  function chartCard(title, key, unit, color) {
    return (
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
            {title}
          </div>
          <div style={{ color: color, fontSize: 12, fontWeight: 700 }}>
            {hLast[key] != null ? parseFloat(hLast[key]).toFixed(unit === "ms" ? 1 : 0) + " " + unit : "—"}
          </div>
        </div>
        <MultiSeriesChart series={makeSeries(key, color)} markerDate={META_MESO_START} />
      </div>
    );
  }
  var totalSessions = Object.keys(trainingDays).filter(function(d) { return d >= cutoffStr; }).length;
  return (
    <div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        {statCard("HRV (7d)", "hrv_sdnn", "ms", C.grn, 1, "up")}
        {statCard("RHR (7d)", "resting_hr", "bpm", C.blu, 0, "down")}
        {statCard("Steps (7d)", "steps", "/d", C.gld, 0, "up")}
      </div>
      {chartCard("HRV SDNN", "hrv_sdnn", "ms", C.grn)}
      {chartCard("Resting HR", "resting_hr", "bpm", C.blu)}
      {chartCard("Active Calories", "active_cal", "kcal", C.org)}
      {chartCard("Exercise Minutes", "exercise_min", "min", C.teal)}
      <div
        style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 }}>
        <div style={{ color: C.txt, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          Recovery Summary (120d)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={{ color: C.mut }}>
            Training sessions
          </div>
          <div style={{ color: C.txt, fontWeight: 700, textAlign: "right" }}>
            {totalSessions}
          </div>
          <div style={{ color: C.mut }}>
            Days w/ HRV
          </div>
          <div style={{ color: C.txt, fontWeight: 700, textAlign: "right" }}>
            {recent.filter(function(h) { return h.hrv_sdnn != null; }).length}
          </div>
          <div style={{ color: C.mut }}>
            Avg HRV
          </div>
          <div style={{ color: C.grn, fontWeight: 700, textAlign: "right" }}>
            {(function() { var arr = recent.filter(function(h) { return h.hrv_sdnn != null; }).map(function(h) { return parseFloat(h.hrv_sdnn); }); return arr.length ? (arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(1) + " ms" : "—"; })()}
          </div>
          <div style={{ color: C.mut }}>
            Avg RHR
          </div>
          <div style={{ color: C.blu, fontWeight: 700, textAlign: "right" }}>
            {(function() { var arr = recent.filter(function(h) { return h.resting_hr != null; }).map(function(h) { return parseFloat(h.resting_hr); }); return arr.length ? (arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(0) + " bpm" : "—"; })()}
          </div>
        </div>
      </div>
    </div>
  );
}
function CompareView() {
  var s1 = React.useState(null); var loaded = s1[0]; var setLoaded = s1[1];
  React.useEffect(function() {
    Promise.all([db.getRecentSessions(1000), db.getHealthDaily(800)])
      .then(function(arr) { setLoaded({ sessions: arr[0] || [], body: arr[1] || [] }); })
      .catch(function() { setLoaded({ sessions: [], body: [] }); });
  }, []);
  if (!loaded) return (
    <div style={{ padding: 32, textAlign: "center", color: C.mut }}>
      Loading…
    </div>
  );
  var mesoOrderMap = {}, mesoSessionsMap = {};
  loaded.sessions.forEach(function(s) {
    var mn = ((s.notes || "").match(/^(Meso \d+)/) || [])[1] || "Other";
    if (!mesoSessionsMap[mn]) { mesoSessionsMap[mn] = []; mesoOrderMap[mn] = true; }
    mesoSessionsMap[mn].push(s);
  });
  var mesoKeys = Object.keys(mesoOrderMap).sort(function(a, b) {
    if (a === "Other") return 1; if (b === "Other") return -1;
    return parseInt((a.match(/\d+/) || [0])[0]) - parseInt((b.match(/\d+/) || [0])[0]);
  });
  if (mesoKeys.length === 0) return (
    <div style={{ padding: 32, textAlign: "center", color: C.mut }}>
      No sessions yet.
    </div>
  );
  var ascBody = loaded.body.filter(function(r) { return r.weight_kg != null || r.body_fat_pct != null; }).slice().sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  var perMeso = mesoKeys.map(function(mn) {
    var mSessions = mesoSessionsMap[mn].slice().sort(function(a, b) { return a.date < b.date ? -1 : 1; });
    var mSets = [];
    mSessions.forEach(function(s) { (s.sets || []).forEach(function(st) { mSets.push(st); }); });
    var totalVolume = 0, topByEx = {}, mgVol = {};
    mSets.forEach(function(st) {
      var w = parseFloat(st.weight) || 0, r = parseInt(st.reps) || 0;
      var e = st.exercises || {};
      totalVolume += (w / (parseFloat(e.cable_ratio) || 1)) * r;
      if (!e.name) return;
      var e1rm = w * (1 + r / 30);
      if (!topByEx[e.name] || e1rm > topByEx[e.name].e1rm) topByEx[e.name] = { e1rm: e1rm, weight: w, reps: r };
      if (e.muscle_group) mgVol[e.muscle_group] = (mgVol[e.muscle_group] || 0) + 1;
    });
    var startDate = mSessions[0].date, endDate = mSessions[mSessions.length - 1].date;
    var startBC = null, endBC = null;
    for (var i = 0; i < ascBody.length; i++) { if (ascBody[i].date >= startDate) { startBC = deriveBodyComp(ascBody[i]); break; } }
    for (var j = ascBody.length - 1; j >= 0; j--) { if (ascBody[j].date <= endDate) { endBC = deriveBodyComp(ascBody[j]); break; } }
    return { mesoNote: mn, sessions: mSessions.length, sets: mSets.length, totalVolume: totalVolume, topByEx: topByEx, mgVol: mgVol, startBC: startBC, endBC: endBC, startDate: startDate, endDate: endDate };
  });
  function deltaCell(curV, prevV, unit, dp, betterDir) {
    var d = curV != null && prevV != null ? curV - prevV : null, dpx = dp == null ? 1 : dp, color = C.mut;
    if (d != null && Math.abs(d) > 0.001) color = betterDir === "up" ? (d > 0 ? C.grn : C.red) : betterDir === "down" ? (d < 0 ? C.grn : C.red) : C.mut;
    return (
      <div style={{ textAlign: "right" }}>
        <div style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>
          {curV != null ? curV.toFixed(dpx) + (unit ? " " + unit : "") : "—"}
        </div>
        {d != null ? <div style={{ color: color, fontSize: 10 }}>
          {fmtSignedNum(d, dpx) + (unit ? " " + unit : "")}
        </div> : null}
      </div>
    );
  }
  return (
    <div>
      {perMeso.map(function(pm, idx) {
        var prev = idx > 0 ? perMeso[idx - 1] : null, prevTopByEx = prev ? prev.topByEx : {};
        var topExNames = Object.keys(pm.topByEx).sort(function(a, b) { return (pm.topByEx[b].e1rm || 0) - (pm.topByEx[a].e1rm || 0); }).slice(0, 6);
        return (
          <div
            key={pm.mesoNote}
            style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 800 }}>
                {pm.mesoNote}
              </div>
              <div style={{ color: C.mut, fontSize: 10 }}>
                {pm.startDate + " → " + pm.endDate}
              </div>
            </div>
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ color: C.mut, fontSize: 9 }}>
                  Sessions
                </div>
                <div style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>
                  {pm.sessions}
                </div>
              </div>
              <div>
                <div style={{ color: C.mut, fontSize: 9 }}>
                  Sets
                </div>
                <div style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>
                  {pm.sets}
                </div>
              </div>
              <div>
                <div style={{ color: C.mut, fontSize: 9 }}>
                  Volume (lb·r)
                </div>
                <div style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>
                  {(pm.totalVolume / 1000).toFixed(1) + "k"}
                </div>
              </div>
            </div>
            {pm.startBC && pm.endBC ? <div
              style={{ borderTop: "1px solid " + C.bdr, paddingTop: 8, marginTop: 4, marginBottom: 8 }}>
              <div
                style={{ color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                Body Comp
              </div>
              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                <div>
                  <div style={{ color: C.mut, fontSize: 9 }}>
                    Weight
                  </div>
                  {deltaCell(pm.endBC.weight, pm.startBC.weight, "lb", 1, "down")}
                </div>
                <div>
                  <div style={{ color: C.mut, fontSize: 9 }}>
                    BF%
                  </div>
                  {deltaCell(pm.endBC.bf, pm.startBC.bf, "%", 1, "down")}
                </div>
                <div>
                  <div style={{ color: C.mut, fontSize: 9 }}>
                    Lean
                  </div>
                  {deltaCell(pm.endBC.lean, pm.startBC.lean, "lb", 1, "up")}
                </div>
                <div>
                  <div style={{ color: C.mut, fontSize: 9 }}>
                    Fat
                  </div>
                  {deltaCell(pm.endBC.fat, pm.startBC.fat, "lb", 1, "down")}
                </div>
              </div>
            </div> : null}
            {topExNames.length ? <div style={{ borderTop: "1px solid " + C.bdr, paddingTop: 8 }}>
              <div
                style={{ color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                Top Lifts (e1RM)
              </div>
              {topExNames.map(function(n) {
                var cur = pm.topByEx[n], prv = prevTopByEx[n];
                return (
                  <div
                    key={n}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid " + C.bdr }}>
                    <div style={{ color: C.txt, flex: 1, marginRight: 8 }}>
                      {n}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ color: C.txt, fontWeight: 700 }}>
                        {cur.e1rm.toFixed(0) + " lb"}
                      </span>
                      {prv ? <span
                        style={{ color: cur.e1rm >= prv.e1rm ? C.grn : C.red, fontSize: 10, marginLeft: 6 }}>
                        {fmtSignedNum(cur.e1rm - prv.e1rm, 0)}
                      </span> : null}
                    </div>
                  </div>
                );
              })}
            </div> : null}
          </div>
        );
      })}
    </div>
  );
}
function AnalyticsView() {
  var s1 = React.useState("body"); var sub = s1[0]; var setSub = s1[1];
  var TABS = [
    { k: "body", label: "Body", color: C.gld },
    { k: "perf", label: "Performance", color: C.blu },
    { k: "rec", label: "Recovery", color: C.grn },
    { k: "cmp", label: "Compare", color: C.pur }
  ];
  return (
    <div style={{ padding: "10px 0 40px" }}>
      <div
        style={{ display: "flex", gap: 4, marginBottom: 12, position: "sticky", top: 0, background: C.bg, zIndex: 4, paddingBottom: 4 }}>
        {TABS.map(function(t) {
          var sel = sub === t.k;
          return (
            <button
              key={t.k}
              onClick={function() { setSub(t.k); }}
              style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: "1px solid " + (sel ? t.color : C.bdr), background: sel ? t.color + "22" : "transparent", color: sel ? t.color : C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {sub === "body" ? <BodyCompView /> :
      sub === "perf" ? <PerformanceView /> :
      sub === "rec" ? <RecoveryView /> :
      <CompareView />}
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
  const [timerKey, setTimerKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [syncStatus, setSyncStatus] = useState("");
  const [dbConnected, setDbConnected] = useState(false);
  const [view, setView] = useState("workout"); // "workout" or "history"
  const sessionStartRef = useRef(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [showFinishReview, setShowFinishReview] = useState(false);
  const [mesoIdx, setMesoIdx] = useState(() => getActiveMeso(localDate()));
  const activeMeso = MESOCYCLES[mesoIdx];
  const activeWeeks = activeMeso.weeks;
  const activeRoutines = activeMeso.routines;
  const [soundOn, setSoundOn] = useState(false);

  const activeRoutineKeys = Object.keys(activeRoutines);
  const r = activeRoutines[activeRoutineKeys[routine]];
  const rKey = activeRoutineKeys[routine];
  const today = localDate();
  const sessionKey = today + "-" + rKey.replace(/\s+/g, "") + "-W" + (week + 1);

  // Auto-detect next routine based on last completed session (current meso only)
  useEffect(() => {
    db.getRecentSessions(20).then(sessions => {
      const routineOrder = ["Upper A", "Lower A", "Upper B", "Lower B"];
      // Filter to current meso's completed sessions
      const completed = sessions.filter(s =>
        s.status === "completed" && s.notes && routineOrder.some(r => s.notes.includes(r))
        && s.notes.includes(activeMeso.shortName)
      );
      if (completed.length === 0) return;
      const last = completed[0];
      const lastMatch = last.notes.match(/(Upper [AB]|Lower [AB])/);
      if (!lastMatch) return;
      const lastIdx = routineOrder.indexOf(lastMatch[1]);
      if (lastIdx === -1) return;
      const nextIdx = (lastIdx + 1) % routineOrder.length;
      const nextKey = routineOrder[nextIdx];
      const appIdx = activeRoutineKeys.indexOf(nextKey);
      if (appIdx !== -1 && appIdx !== routine) setRoutine(appIdx);

      // Extract week from last session notes (e.g. "Meso 1-W2D4-Lower B" → week 2)
      const weekMatch = last.notes.match(/W(\d+)D/);
      if (weekMatch) {
        const lastWeek = parseInt(weekMatch[1]);
        // If D4 was last (wrapping to D1), advance to next week
        const targetWeek = nextIdx === 0 ? lastWeek + 1 : lastWeek;
        const weekIdx = targetWeek - 1; // 0-indexed
        if (weekIdx >= 0 && weekIdx < activeWeeks.length && weekIdx !== week) {
          setWeek(weekIdx);
        }
      }
    }).catch(() => {});
  }, []);

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
  const syncToDb = useCallback(async (exercise, setNum, reps, weight, band, muscles) => {
    if (!currentSession) return;
    try {
      setSyncStatus("saving...");
      await db.logSet(currentSession.id, exercise, setNum, reps, weight, band, muscles);
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
    // Issue #2: Cap rest at 75s during deload weeks
    const isDeload = activeWeeks[week]?.deload;
    const deloadRest = isDeload ? Math.min(seconds, 75) : seconds;
    setTimerKey(k => k + 1);
    setTimer({ seconds: deloadRest, exName, setNum, totalSets });
  }, [activeWeeks, week]);

  // Build next set info for the RestTimer's NextSetCard
  // Handles: next set of same exercise, OR first set of next exercise
  // Returns null only for the very last set of the very last exercise
  const getNextSetInfo = useCallback(() => {
    if (!timer) return null;
    const wkData = activeWeeks[week];
    // Flatten all exercises in order
    const allExercises = r.sections.flatMap(sec => sec.exercises);
    const currentIdx = allExercises.findIndex(ex => ex.name === timer.exName);
    if (currentIdx === -1) return null;
    const currentEx = allExercises[currentIdx];
    const exKey = `${sessionKey}|${currentEx.name}`;
    const logged = allSets[exKey] || {};
    const nextSetNum = timer.setNum + 1;

    if (nextSetNum <= currentEx.sets) {
      // Next set of SAME exercise
      const exCat = getExCategory(currentEx.name, currentEx.rest);
      const minStep = exCat === "smith" ? 5 : 2.5;
      const weeklyAdd = wkData[exCat];
      const baseTarget = currentEx.wt ? (wkData.deload ? (wkData.preDeloaded ? currentEx.wt : Math.round(currentEx.wt * 0.5 / minStep) * minStep) : Math.round((currentEx.wt + weeklyAdd) / minStep) * minStep) : null;
      const lastLogged = logged[timer.setNum];
      const targetWt = lastLogged ? lastLogged.wt : baseTarget;
      const targetReps = currentEx.reps.split("-")[0];
      return { exName: currentEx.name, muscles: currentEx.muscles, nextSetNum, totalSets: currentEx.sets, targetReps, targetWt, isBW: !currentEx.wt && currentEx.wt !== 0, restSeconds: currentEx.rest, isLastExInSession: false };
    }

    // Current exercise is done — find next exercise
    const nextEx = allExercises[currentIdx + 1];
    if (!nextEx) return null; // Last exercise in session — no next set card

    // First set of next exercise
    const exCat = getExCategory(nextEx.name, nextEx.rest);
    const minStep = exCat === "smith" ? 5 : 2.5;
    const weeklyAdd = wkData[exCat];
    const baseTarget = nextEx.wt ? (wkData.deload ? (wkData.preDeloaded ? nextEx.wt : Math.round(nextEx.wt * 0.5 / minStep) * minStep) : Math.round((nextEx.wt + weeklyAdd) / minStep) * minStep) : null;
    const targetReps = nextEx.reps.split("-")[0];
    const isLastEx = currentIdx + 1 === allExercises.length - 1;
    return { exName: nextEx.name, muscles: nextEx.muscles, nextSetNum: 1, totalSets: nextEx.sets, targetReps, targetWt: baseTarget, isBW: !nextEx.wt && nextEx.wt !== 0, restSeconds: nextEx.rest, isLastExInSession: isLastEx, isNewExercise: true };
  }, [timer, r, sessionKey, allSets, activeWeeks, week]);

  // Handle logging a set from the timer's NextSetCard
  const logFromTimer = useCallback((exName, setNum, data, nextSetInfo, dismissTimer) => {
    const exKey = `${sessionKey}|${exName}`;
    setAllSets(prev => ({ ...prev, [exKey]: { ...(prev[exKey] || {}), [setNum]: data } }));
    const allExercisesForSync = r.sections.flatMap(sec => sec.exercises);
    const curExForSync = allExercisesForSync.find(ex => ex.name === exName);
    syncToDb(exName, setNum, data.reps, data.wt, data.band, curExForSync ? curExForSync.muscles : null);

    // Start rest timer for next set — unless this is the final set of the session
    if (nextSetInfo) {
      const allExercises = r.sections.flatMap(sec => sec.exercises);
      const isLastExercise = allExercises[allExercises.length - 1]?.name === exName;
      const currentEx = allExercises.find(ex => ex.name === exName);
      const isLastSet = currentEx && setNum >= currentEx.sets;
      const isFinalSetOfSession = isLastExercise && isLastSet;

      if (!isFinalSetOfSession) {
        const restEx = allExercises.find(ex => ex.name === exName);
        const restSeconds = restEx ? restEx.rest : 90;
        const isDeload = activeWeeks[week]?.deload;
        const cappedRest = isDeload ? Math.min(restSeconds, 75) : restSeconds;
        setTimerKey(k => k + 1);
        setTimer({ seconds: cappedRest, exName, setNum, totalSets: currentEx?.sets || nextSetInfo.totalSets });
      } else {
        // Final set of session — dismiss the timer overlay
        setTimer(null);
      }
    } else {
      setTimer(null);
    }
  }, [sessionKey, syncToDb, r, activeWeeks, week]);

  const W = { background: C.bg, minHeight: "100vh", color: C.txt, fontFamily: "'SF Pro Display',system-ui,sans-serif", padding: "12px 10px", paddingTop: timer ? 64 : 12, maxWidth: 480, margin: "0 auto", overflowX: "hidden" };

  return (
    <div style={W}>
      {/* GLOBAL REST TIMER */}
      {timer && (
        <RestTimer
          key={timerKey}
          seconds={timer.seconds}
          exName={timer.exName}
          setNum={timer.setNum}
          totalSets={timer.totalSets}
          onDone={() => setTimer(null)}
          nextSetInfo={getNextSetInfo()}
          onLogFromTimer={logFromTimer}
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
          </button><button onClick={() => setView("analytics")} style={{ flex: 1, padding: "6px", borderRadius: 8, border: "1px solid " + C.bdr, color: C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer", background: "transparent" }}>Analytics</button>
        </div>
      </div>

      {/* Mesocycle selector */}
      {MESOCYCLES.length > 1 && view === "workout" && (
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {MESOCYCLES.map((m, i) => {
            const isActive = i === mesoIdx;
            const isCurrent = i === getActiveMeso(localDate());
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
      </div><div style={{ display: view === "analytics" ? "block" : "none" }}><AnalyticsView /></div>

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
            {sec.exercises.map((ex, ei) => {
              const isLastSec = si === r.sections.length - 1;
              const isLastEx = isLastSec && ei === sec.exercises.length - 1;
              return <ExerciseCard key={ei} ex={ex} week={week} weeksConfig={activeWeeks} sessionKey={sessionKey} allSets={allSets} setAllSets={setAllSets} onStartRest={startRest} onSave={saveToStorage} onSync={syncToDb} onDeleteFromDb={deleteFromDb} mesoPrefix={activeMeso.shortName} isLastExercise={isLastEx} />;
            })}
          </div>
        ))}

        {/* Finish Session + Export */}
        {!sessionStarted ? (
          <div style={{ marginTop: 16 }}>
            <button onClick={() => { sessionStartRef.current = Date.now(); setSessionStarted(true); }}
              style={{ width: "100%", padding: "14px", borderRadius: 10, border: `1px solid ${C.blu}44`, background: C.blu + "11", color: C.blu, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ▶ Start Session
            </button>
          </div>
        ) : !showFinishReview ? (
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
              {rKey} · {activeWeeks[week].rir} · {Math.round((Date.now() - (sessionStartRef.current || Date.now())) / 60000)} min
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
                  const mins = Math.round((Date.now() - (sessionStartRef.current || Date.now())) / 60000);
                  await db.finishSession(currentSession.id, mins);
                  // Fix date: update session date to actual completion date
                  const actualDate = localDate();
                  if (currentSession.date !== actualDate) {
                    await db.updateSession(currentSession.id, { date: actualDate });
                  }
                  // Save performance data to localStorage for next-session weight/rep suggestions
                  saveSessionPerformance(allSets, sessionKey, week + 1, activeWeeks[week].rir, activeMeso.shortName);
                  // Advance to next routine in cycle
                  const nextRoutine = (routine + 1) % activeRoutineKeys.length;
                  // If wrapping back to D1, advance to next week
                  if (nextRoutine === 0 && week < activeWeeks.length - 1) {
                    setWeek(week + 1);
                  }
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
