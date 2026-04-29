# Training Hub — Complete Master Brief for Claude Code
**Updated:** April 21, 2026  
**Author:** Built by Blake Isom with Claude (Anthropic)

---

## 1. WHAT THIS IS

A workout tracking PWA built for one user (Blake) on a specific piece of equipment (ForceUSA G3 all-in-one Smith machine), following a specific training methodology (Renaissance Periodization / RP hypertrophy). The app runs as a Progressive Web App on iPhone via Safari's "Add to Home Screen."

**Live URL:** blake-training-hub.vercel.app  
**Repo:** github.com/isomblake/blake-training-hub  
**Stack:** React (CRA single-file) + Supabase (Postgres + Edge Functions) + Vercel  
**Lines of code:** ~2,200 in a single `src/App.jsx`

---

## 2. THE USER

Blake is 6'3", 205 lbs with a lanky build. Former ETSU track and field thrower pursuing body recomposition (lose fat, build lean muscle) with a hypertrophy focus. He trains 4 days/week and is philosophically aligned with Renaissance Periodization (RP) and Dr. Mike Israetel's framework.

He is NOT a software developer. This entire app was built through conversations with Claude — first via Claude chat with Git Bash commands, then via Claude's direct GitHub push access, and now autonomous via Claude Code/Dispatch.

**Preferences:**
- Terse, directive communication
- Wants code written and pushed, not explained at length
- One change at a time, verify, then commit
- Dark themed UI
- Drills down on every data point
- Analytical — wants insight and prescriptions, not status readouts

---

## 3. THE EQUIPMENT

**ForceUSA G3 All-in-One:**
- Smith machine (1:1 ratio — bar weight matches plates loaded)
- Dual cable system (2:1 pulley ratio — 40lb on stack = 20lb actual resistance)
- Landmine attachment
- Chin-up bar
- Minimum weight increment: 5 lbs (2.5 lb plates per side)

All weights in the app are logged as **plates loaded on the machine** — the system handles ratio math internally.

---

## 4. THE TRAINING PHILOSOPHY (RP)

Renaissance Periodization structures training into **mesocycles** (4-6 week blocks):

**Within a meso:**
- Volume (total hard sets per muscle group) starts at MEV (Minimum Effective Volume) and ramps to MAV/MRV
- RIR (Reps in Reserve) decreases week by week: W1:4 → W2:3 → W3:2 → W4:2 → W5:0-1 → W6:deload
- Rep ranges stay the same — progression is through volume, proximity to failure, and small weight increments
- Rest times by category: compounds 2:30, secondary compounds 2:00, arms 1:30, isolations 1:00
- Deload week: 50% weight, 50% sets (2 per exercise), high RIR, short rests (capped at 75s)

**Between mesos:**
- Rotate 1-2 exercises per muscle group
- Start at higher volume floor based on previous meso's ending volume
- Carry forward ending weights as new floor

**Volume landmarks per muscle group:**
- MEV: minimum sets/week to maintain
- MAV: maximum adaptive volume (sweet spot)
- MRV: maximum recoverable volume (ceiling before overtraining)
- These are stored in the `volume_landmarks` Supabase table (13 rows)

---

## 5. CURRENT TRAINING STATE

### Meso 0: Sculpted Strength (Feb 9 – Apr 12, 2026)
- Completed. Historical data migrated (42 sessions, 971 sets).
- W9 was a deload using Meso 1 exercises at 50% weight as a "dress rehearsal"

### Meso 1: RP Hypertrophy (Apr 13 – May 24, 2026)
- **Currently in progress**
- Split: Upper A (D1) / Lower A (D2) / Upper B (D3) / Lower B (D4)
- 5 accumulation weeks + 1 deload week

### All 24 Exercises (with W1 starting weights in plates loaded)

**Upper A (D1):** Smith Flat Bench 120, Smith Incline 75, Chin-Ups (banded BW), Seated Cable Row 140, Cable Lateral Raise 15, Cable Face Pull 70, Cable EZ Bar Curl 65, Cable OH Tricep Extension 60

**Lower A (D2):** Smith Front Squat 105, Smith Stiff-Leg Deadlift 115, Landmine Goblet Squat 30, Smith Deficit Calf Raise 115, Cable Crunch 45, Cable Upright Row 40

**Upper B (D3):** Smith Close-Grip Bench 75, Cable Fly Low-to-High 15, Cable Lat Pulldown Close 180, Landmine Row 20/arm, Cable Cross-Body Lateral 10, Cable Rear Delt Fly 10, Cable Bayesian Curl 20, Cable Pushdown 65

**Lower B (D4):** Smith Hack Squat 95, Smith Good Morning 75, Smith Lunge Front Elevated 40, Smith Deficit Calf Raise 115, Hanging Knee Raise BW, Cable Upright Row 40

---

## 6. APP ARCHITECTURE

```
iPhone PWA (Safari Add to Home Screen)
    ↓ HTTPS
React SPA (Vercel auto-deploy from GitHub)
    ↓ REST API
Supabase Postgres + Edge Functions
    ├── 10 tables
    ├── Edge Function: send-push (Web Push via npm:web-push)
    └── Project ref: bahpdsjlshwphqjdxusi
```

### Single-File Pattern
The entire app lives in `src/App.jsx` (~2,200 lines). No component files, no CSS files, no routing. Everything is inline styles with a color constants object (`C`). This is deliberate — it makes Claude edits simpler (one file to read/write) at the cost of conventional code organization.

### Key Constraints
- **React.createElement only** — no JSX backticks in template literals (caused build failures early on)
- **Color keys:** `C.txt / C.mut / C.card / C.bdr / C.grn / C.red / C.gld / C.blu / C.pur / C.org / C.teal`
- **CI=true required for builds** — Vercel treats ESLint warnings as errors, must test locally with `CI=true npm run build`
- **No localStorage reliance** — iOS PWAs don't persist localStorage reliably. Use Supabase for state.

---

## 7. DATABASE SCHEMA (Supabase)

| Table | Rows | Purpose |
|-------|------|---------|
| exercises | 95 | Master exercise library (name, muscles, equipment, vid_url, muscle_group, cable_ratio) |
| sessions | 73+ | Workout sessions (date, week_number, rir, status, notes, duration_minutes, mesocycle_id) |
| sets | 1,131+ | Individual sets (session_id, exercise_id, set_number, reps, weight, band) |
| mesocycles | 3 | Mesocycle definitions (name, start_date, end_date, status) |
| volume_landmarks | 13 | RP volume landmarks per muscle group (muscle_group, mev, mav, mrv) |
| push_subscriptions | 0-1 | Web Push subscription (endpoint, p256dh, auth) |
| body_comp | 0 | **EMPTY** — for weight/BF%/lean mass tracking |
| muscle_volume | 0 | **EMPTY** — for weekly volume per muscle group |
| routines | 0 | **UNUSED** — routines are hardcoded in App.jsx |
| routine_exercises | 0 | **UNUSED** |

**RLS:** All tables have Row Level Security enabled with permissive policies (single-user app).

---

## 8. APP.JSX STRUCTURE (~2,200 lines)

| Lines | Section | Description |
|-------|---------|-------------|
| 1-2 | Imports | React, Supabase |
| 4-87 | Sound System | AudioContext, silent oscillator keep-alive, iOS audio tricks |
| 88-260 | Push Notifications | Service worker registration, VAPID, visibilitychange scheduling, Edge Function calls |
| 261-628 | Database Helpers | `db` object with all Supabase queries (getOrCreateSession, syncSet, finishSession, getLastSessionForExercise, getRecentSessions, getExerciseProgression) |
| 630-657 | Constants | Color theme (C), weight progression config (WEEKS array), exercise category classifier |
| 658-820 | Mesocycle Definitions | MESO1_ROUTINES, makeDeloadRoutines, MESOCYCLES array with date ranges |
| 821-870 | Helper Functions | localDate, getActiveMeso, fmtRest, fmtTimer |
| 870-1000 | SetRow Component | React.memo'd individual set input row with log/edit/delete |
| 1000-1200 | RestTimer Component | Full-screen countdown, compact bar, Next Set card, swipe gestures |
| 1200-1400 | ExerciseCard Component | Expandable card per exercise with progression logic |
| 1400-1700 | HistoryView Component | Session list with per-set data, edit/delete |
| 1700-2200 | App Component | Main orchestrator — state, session management, layout |

---

## 9. KEY FEATURES

### Workout Logging
- Tap exercise → expand → log sets with reps × weight
- Auto-progression algorithm suggests target weight based on last session
- Weight cascade: changing weight on a set updates remaining unlogged sets
- Band selector for chin-ups (Green/Purple/Black/Red/None)
- Form video links for every exercise

### Rest Timer
- Full-screen mode with circular progress ring
- Compact/minimized bar at top
- Auto-expand at 10 seconds remaining
- Warning sound at 10s, completion chime at 0s
- Swipe up/down to toggle between full-screen and compact
- Deload week auto-caps rest at 75 seconds

### Next Set Card
- After rest timer completes, full-screen card shows next set details
- Pre-filled with exercise name, muscles, target reps, target weight
- "Log Set" button logs directly and starts the next rest timer
- Cross-exercise transitions: shows first set of next exercise when current one is done
- No card after final set of final exercise (session done)
- Swipe up to dismiss (visual handle bar at top)
- Uses `key={timerKey}` to force fresh React state on each new timer

### Session Management
- **Start Session** button begins duration timer
- **Finish Session** shows review screen → saves duration → updates date to completion day → advances to next routine/week
- Auto-detect on app load: queries last completed session, advances to correct routine (D1-D4) and correct week
- D4 completion advances to D1 of NEXT week

### Push Notifications (Background Alerts)
- Service worker (`public/sw.js`) registered on page load
- When rest timer is active and app goes to background → `visibilitychange` listener fires → calls Supabase Edge Function `send-push` with remaining time as delay
- Edge Function uses `npm:web-push@3.6.7` with server-side `setTimeout` → sends Web Push notification
- Service worker receives push → checks if app window is focused → only shows banner if app is NOT visible
- When timer is cancelled in-app, the listener is removed so no push is sent
- VAPID keys stored as Edge Function secrets

### Sound System
- Web Audio API oscillators (mix with Spotify, don't take over audio session)
- Silent oscillator keep-alive prevents iOS from suspending AudioContext
- Sound suppress on return from background (2000ms window blocks stale queued sounds)
- Three sounds: warning ding (10s), completion chime (ascending C5-E5-G5), rest beep

---

## 10. DEVELOPMENT WORKFLOW

### Claude Has Direct Push Access
```bash
# Clone
git clone https://ghp_TOKEN@github.com/isomblake/blake-training-hub.git
cd training-hub
git config user.email "blake@training-hub.app"
git config user.name "Claude"
npm install

# Edit → Build → Push
# Edit src/App.jsx
CI=true npm run build    # MUST pass before pushing
git add . && git commit -m "description" && git push
# Vercel auto-deploys in 60-90 seconds
```

### Supabase Changes
- Cannot reach api.supabase.com from sandbox (firewall)
- Use Chrome extension to drive Supabase dashboard
- SQL Editor for table changes
- Edge Functions UI for function deployment
- Monaco editor injection via `window.monaco.editor.getEditors()[0].setValue(code)`

### Key Development Patterns
- **Node.js scripts** for surgical edits when using Git Bash: `node -e "const fs=require('fs');..."`
- **Heredoc scripts** for complex edits: `cat > /tmp/fix.js << 'EOF' ... EOF && node /tmp/fix.js`
- **Always verify** with `grep -n "search term" src/App.jsx` before committing
- **Always build test** with `CI=true npm run build` — ESLint warnings are fatal

---

## 11. EVOLUTION HISTORY (98 commits)

### Phase 1: Foundation (commit 00696c0 → 280ef62)
- Initial React app with Supabase
- Exercise definitions, basic set logging
- Sound system iterations (Tone.js → Web Audio API → AudioContext oscillators)
- Rest timer (expandable, swipe gestures, sticky compact bar)
- Auto-progression algorithm
- Session review before finishing

### Phase 2: Polish & Data Migration (280ef62 → 3627b0e)
- History view with per-set edit/delete
- Mesocycle selector with deload support
- Band selector for chin-ups
- ForceUSA workout history migration (42 sessions, 971 sets)
- Session date fix (UTC timezone drift)
- Meso data bleed prevention (filter by mesocycle)

### Phase 3: Smart Features (3627b0e → d55f6bb)
- Auto-detect next routine from last completed session
- Auto-advance week after D4 completion
- Start Session / Finish Session with duration tracking
- Date updates to actual completion date
- Session lookup by week/routine (not date)

### Phase 4: Next Set Card (d55f6bb → 8a62554)
- Full-screen card after rest with exercise details
- Cross-exercise transitions
- Inline logging from the card
- Timer race condition fix (key={timerKey})
- Swipe up to dismiss
- Push notifications via service worker + Edge Function
- Notification architecture: only push when backgrounded, cancellable

---

## 12. OPEN ISSUES

### 🔴 Push Notifications
The full pipeline is built but may not be fully functional end-to-end on iOS:
- Service worker registers on page load
- Push subscription flow runs when Sound is enabled
- Edge Function is deployed
- VAPID keys are stored
- **Needs real-world testing** — zero invocations on the Edge Function as of last check
- The `npm:web-push` Deno compatibility is unverified
- iOS PWA push notification support requires iOS 16.4+

### 🟡 Sound in Background
iOS fundamentally suspends JavaScript when the app is backgrounded. Sounds cannot play while suspended. The push notification system is the workaround — banner notifications with vibration replace sounds when backgrounded. When the app is in the foreground, in-app sounds play normally.

### 🟡 PWA Caching
iOS aggressively caches the PWA. After deploys, Blake may need to delete the PWA from home screen and re-add it from Safari to get the latest version.

### 🟡 Supabase Quota
Free plan has exceeded quota. Grace period until May 21, 2026. May need to upgrade or optimize usage.

---

## 13. WHAT'S NEXT

### Body & Performance Analytics (PRIORITY)
- Volume dashboard: sets per muscle group per week vs RP landmarks (MEV/MAV/MRV)
- Progression charts: weight over time per exercise
- Body comp tracking: weight, body fat %, lean mass with trend lines
- Session summary stats
- Leverage existing empty tables: `body_comp`, `muscle_volume`
- Blake has an outdated analytics design from ~2 weeks ago that needs updating

### Meso 2 Programming
- Build during Meso 1 deload week (~May 19)
- Exercise rotation (1-2 swaps per muscle group)
- Higher starting volume based on Meso 1 ending volume
- Carry forward weights

### Future
- Smart mid-workout weight adjustment algorithm
- Cross-mesocycle progression tracking
- Apple Health integration (currently empty arrays in code)

---

## 14. FILE MAP

```
training-hub/
├── src/
│   ├── App.jsx              # The entire app (~2,200 lines)
│   ├── index.js             # React entry point
│   └── supabaseClient.js    # Supabase connection config (uses env vars)
├── public/
│   ├── index.html           # PWA meta tags, manifest link
│   ├── manifest.json        # PWA config (standalone, dark theme)
│   └── sw.js                # Service worker for push notifications
├── cloud/
│   ├── sql/
│   │   └── 01_push_subscriptions.sql
│   └── supabase/
│       └── functions/
│           └── send-push/index.ts   # Edge Function (reference copy)
├── MASTER_BRIEF.md          # This file
├── package.json
├── migrate-history.sql      # ForceUSA workout history migration
├── supabase-schema.sql      # Database schema
└── SETUP.md                 # Deployment guide
```
