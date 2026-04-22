# Training Hub — Master Brief
**Updated:** April 21, 2026

---

## Project Overview

**App:** blake-training-hub.vercel.app  
**Repo:** github.com/isomblake/blake-training-hub  
**Stack:** React (CRA) + Supabase (Postgres + Edge Functions) + Vercel  
**Local Path:** `/c/Users/"Blake Isom"/Downloads/training-hub` (Git Bash on Windows)  
**Purpose:** RP hypertrophy training tracker for ForceUSA G3 all-in-one Smith machine  
**User:** Blake — 6'3", 205 lbs, former ETSU track and field thrower, pursuing body recomposition

---

## Architecture

```
iPhone (PWA via Safari "Add to Home Screen")
    ↓
React App (Vercel) — src/App.jsx (2086 lines, single-file app)
    ↓
Supabase (Postgres + Edge Functions)
    ├── 10 tables (sessions, sets, exercises, mesocycles, push_subscriptions, etc.)
    ├── Edge Function: send-push (Web Push notifications via server-side delay)
    └── Project ref: bahpdsjlshwphqjdxusi
```

---

## Deployment Workflow

Claude has direct push access to the GitHub repo via PAT. The workflow is:

1. Clone/pull the repo in sandbox
2. Edit `src/App.jsx` directly
3. Run `CI=true npm run build` — Vercel treats ESLint warnings as fatal with CI=true
4. `git add . && git commit -m "..." && git push`
5. Vercel auto-deploys in 60-90 seconds
6. Verify via Vercel deployments dashboard or Chrome extension

For Supabase changes (SQL, Edge Functions), drive the dashboard via Chrome extension — sandbox cannot reach api.supabase.com directly.

**Git config:** `user.email: blake@training-hub.app`, `user.name: Claude`

---

## Database Schema (Supabase)

| Table | Rows | Purpose |
|-------|------|---------|
| exercises | 95 | Master exercise library with muscles, equipment, vid_url, muscle_group |
| sessions | 73+ | Workout sessions with date, week_number, rir, status, notes, duration |
| sets | 1,131+ | Individual set records: session_id, exercise_id, set_number, reps, weight |
| mesocycles | 3 | Mesocycle definitions (Natural Strength, Sculpted Strength, RP Meso 1) |
| body_comp | 0 | Body composition tracking (weight, bf%, lean mass) — NOT YET USED |
| muscle_volume | 0 | Weekly volume per muscle group — NOT YET USED |
| volume_landmarks | 13 | RP volume landmarks (MEV, MAV, MRV per muscle group) |
| routines | 0 | Routine templates — NOT YET USED (routines are hardcoded in App.jsx) |
| routine_exercises | 0 | Exercise-to-routine mappings — NOT YET USED |
| push_subscriptions | 0-1 | Web Push subscription storage for background notifications |

**Note:** body_comp, muscle_volume, routines, and routine_exercises tables exist but are unused. The analytics dashboard should leverage these.

---

## App Structure (src/App.jsx)

### Top-Level Sections (2086 lines)

| Lines | Section |
|-------|---------|
| 1-2 | Imports (React, Supabase) |
| 4-87 | Sound System (AudioContext, keep-alive oscillator, warning/rest beep) |
| 88-181 | Push Notification System (service worker, VAPID, Edge Function calls) |
| 183-220 | Audio playback functions (_playOsc, playWarningSound, playRestBeep) |
| 222-548 | Database Helpers (db object with all Supabase queries) |
| 550-570 | Color constants (C object — dark theme) |
| 572-604 | Weight progression config (WEEKS array — RIR, weight increments per week) |
| 605-710 | Exercise/Routine definitions (MESO1_ROUTINES, DELOAD_ROUTINES, MESOCYCLES) |
| 711-786 | Helper functions (localDate, getActiveMeso, fmtRest, etc.) |
| 788-918 | SetRow component (individual set input row with log/edit/delete) |
| 920-1126 | RestTimer component (full-screen + compact bar + Next Set card) |
| 1128-1288 | ExerciseCard component (expandable exercise with sets, progression notes) |
| 1289-1588 | HistoryView component (session list with edit/delete per set/session) |
| 1590-2086 | App component (main state, session management, layout, buttons) |

### Key Components

- **SetRow** — React.memo'd row for each set. Shows reps × weight inputs, log/edit/delete buttons, band selector for chin-ups.
- **RestTimer** — Full-screen countdown with progress ring, compact bar mode, swipe to expand/collapse. After completion shows **Next Set card** with exercise details and inline log button. Transitions between exercises.
- **ExerciseCard** — Expandable card per exercise. Shows target sets × reps @ weight, smart weight progression notes from Set Progression Algorithm, form video links.
- **HistoryView** — Lists all past sessions grouped by date. Expandable to show per-set data. Edit/delete per set and per session.
- **App** — Main orchestrator. Manages mesocycle/week/routine selection, session creation/loading, sync to Supabase, Start/Finish session flow.

### Key Features

- **Auto-detect next routine:** On app load, queries last completed session and advances to next routine + correct week
- **Smart weight progression:** Set Progression Algorithm checks last session's data and adjusts target weight (bump if exceeded range, hold if below min reps)
- **Deload auto-adjustments:** Week 6 caps rest at 75s, uses 50% weights, 2 sets per exercise
- **Start/Finish Session:** Explicit start button begins duration timer. Finish shows review screen with all logged sets, then saves duration and advances routine.
- **Date fix:** Session date updates to actual completion date on finish (not creation date)
- **D4 → D1 week advance:** After completing Lower B, auto-advances to next week's Upper A
- **Push notifications:** Server-side delayed notifications via Supabase Edge Function. Fires at 10s warning and at timer completion, even when app is backgrounded on iOS.
- **Sound system:** Web Audio API with silent oscillator keep-alive. Sounds suppressed while backgrounded to prevent stale queue playback on return.
- **Next Set card:** After rest timer completes, full-screen card shows next set details (same exercise or first set of next exercise) with pre-filled reps/weight and inline log button.

---

## Current Mesocycles

### Meso 0: Sculpted Strength (Feb 9 – Apr 12)
- 8 weeks completed, W9 deload used Meso 1 exercises at 50% weight
- Historical data migrated (42 sessions, 971 sets)

### Meso 1: RP Hypertrophy (Apr 13 – May 24)
- **Split:** Upper A (D1) / Lower A (D2) / Upper B (D3) / Lower B (D4)
- **Weeks:** 5 accumulation + 1 deload (6 total)
- **RIR progression:** W1:4 → W2:3 → W3:2 → W4:2 → W5:0-1 → W6:4 (deload)
- **Volume:** Start at MEV, add 1-2 sets/muscle/week toward MAV
- **24 exercises** across 4 routines, all mapped to G3 equipment

### Meso 1 Exercises by Routine

**Upper A (D1):** Smith Flat Bench (120lb), Smith Incline Press (75lb), Chin-Ups (banded), Seated Cable Row (140lb), Cable Lateral Raise (15lb), Cable Face Pull (70lb), Cable EZ Bar Curl (65lb), Cable OH Tricep Extension (60lb)

**Lower A (D2):** Smith Front Squat (105lb), Smith Stiff-Leg Deadlift (115lb), Landmine Goblet Squat (30lb), Smith Deficit Calf Raise (115lb), Cable Crunch (45lb), Cable Upright Row (40lb)

**Upper B (D3):** Smith Close-Grip Bench (75lb), Cable Fly Low-to-High (15lb), Cable Lat Pulldown Close (180lb), Landmine Row (20lb/arm), Cable Cross-Body Lateral (10lb), Cable Rear Delt Fly (10lb), Cable Bayesian Curl (20lb), Cable Pushdown (65lb)

**Lower B (D4):** Smith Hack Squat (95lb), Smith Good Morning (75lb), Smith Lunge Front Elevated (40lb), Smith Deficit Calf Raise (115lb), Hanging Knee Raise (BW), Cable Upright Row (40lb)

---

## Equipment

**ForceUSA G3 All-in-One:**
- Smith machine (1:1 ratio)
- Dual cable system (2:1 pulley ratio — 40lb on stack = 20lb actual resistance)
- Landmine attachment
- Chin-up bar
- Minimum weight increment: 5 lbs (2.5 lb plates per side)

---

## RP Methodology Context

- **Volume landmarks:** MEV (minimum effective volume), MAV (maximum adaptive volume), MRV (maximum recoverable volume) per muscle group
- **Progression within a meso:** Add sets, increase proximity to failure (lower RIR), small weight increments — NOT rep scheme changes
- **Between mesos:** Rotate 1-2 exercises per muscle group, start at higher volume floor, carry forward weights
- **Cable isolations** (lateral raises, rear delt flys) carry high fatigue-to-stimulus ratio — Blake finds these disproportionately fatiguing
- **Previous program gaps:** Biceps, side delts, lats were below MEV in Sculpted Strength. Meso 1 corrects this with significant volume increases. Glutes were above MRV and were reduced.

---

## What's Built & Working

- ✅ Full gym log with Meso 0 deload + Meso 1 routines
- ✅ Real-time Supabase sync
- ✅ Session history with per-set edit/delete
- ✅ Rest timer (full-screen + compact) with sound and vibration
- ✅ Next Set card after rest with inline logging
- ✅ Push notifications via service worker + Edge Function
- ✅ Start/Finish session with duration tracking
- ✅ Auto-detect next routine + week on app load
- ✅ Smart weight progression (Set Progression Algorithm)
- ✅ Deload auto-adjustments (rest, weight, sets)
- ✅ Exercise form video links (M&S, BarBend, Dr. Mike)
- ✅ Export to clipboard for Claude analysis

---

## What's Next to Build

### Body & Performance Analytics (PRIORITY)
- Volume dashboard: sets per muscle group per week vs RP landmarks (MEV/MAV/MRV)
- Progression charts: weight over time per exercise
- Body comp tracking: weight, body fat %, lean mass with trend lines
- Session summary stats: total volume, duration trends
- Muscle group heatmap: over/under-volume visualization

### Future Features
- Meso 2 programming (build during Meso 1 deload using real data)
- Mesocycle planner for Meso 2+
- Smart mid-workout weight adjustment algorithm
- Strength progression charts across mesocycles

---

## Known Issues / Monitoring

- **PWA cache:** iOS aggressively caches. After deploys, may need to delete PWA and re-add from Safari.
- **Supabase quota:** Free plan exceeded quota, grace period until May 21, 2026. May need to upgrade.
- **Edge Function timeout:** 150-second max on free plan. Matches longest rest (2:30) exactly — completion notification may not fire for 150s rests.
- **Push notifications untested:** The full Web Push pipeline is deployed but has not been tested end-to-end on iOS yet.

---

## Development Preferences

- Receives runnable code directly, not manual instructions
- One change at a time, verify, then commit
- Always run `CI=true npm run build` before pushing
- Terse communication, expects autonomous execution
- Dark themed UIs
- Single-file React app pattern (everything in App.jsx)
- Node.js v24.14.1 on home computer

---

## Access

- **GitHub:** Claude has push access via PAT (set as remote URL auth)
- **Supabase:** Dashboard accessible via Chrome extension (project: bahpdsjlshwphqjdxusi)
- **Vercel:** Deployments viewable via Chrome extension
- **Supabase Edge Functions:** Deployed via dashboard UI editor
