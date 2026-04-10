# Training Hub — Master Brief
**Updated:** April 9, 2026

---

## Project Overview

- **App:** blake-training-hub.vercel.app
- **Stack:** React + Supabase + Vercel
- **Repo:** github.com/isomblake/blake-training-hub
- **Local Path:** /c/Users/"Blake Isom"/Downloads/training-hub (Git Bash)
- **Purpose:** RP hypertrophy training tracker for ForceUSA G3 all-in-one Smith machine

---

## Current State

### Deployed & Working
- Full gym log with Meso 0 (Sculpted Strength deload) and Meso 1 (RP Hypertrophy) routines
- Supabase real-time sync (sessions, sets, exercises)
- Session history with edit/delete per set and per session
- Exercise cards with form video links (M&S, BarBend, Dr. Mike)
- Rest timer with full-screen and minimized modes
- Sound system with silent oscillator keep-alive for iOS
- Export to clipboard for Claude analysis
- Auto-detect next routine from last completed session

### Database (Supabase)
- **Tables:** exercises, mesocycles, sessions, sets, body_comp, volume_landmarks + others (9 total)
- **Data:** 42+ migrated sessions, 971+ sets from ForceUSA history
- **All 24 exercises** mapped with muscle groups and form video URLs

### Mesocycles in App
- **Meso 0 (Sculpted Strength):** Feb 9 – Apr 12, W9 deload uses Meso 1 exercises at 50% weight
- **Meso 1 (RP Hypertrophy):** Apr 13 – May 24, Upper A/Lower A/Upper B/Lower B, 5 weeks + deload

---

## Fixes Applied (April 9, 2026 Session)

### Issue #1: Background Timer Notifications
- Added Web Notification API as fallback for iOS PWA background audio
- Requests permission when sound is enabled
- Schedules notification when rest timer starts, fires even if app is backgrounded

### Issue #2: Deload Rest Periods
- Rest timer auto-caps at 75 seconds during deload weeks
- Applied at three levels: exercise card display, logSet onStartRest call, and App-level startRest callback
- Uses `Math.min(ex.rest, 75)` so shorter rests stay unchanged

### Issue #3: Auto-Expand Timer at 10s
- When rest timer is minimized and hits 10 seconds remaining, auto-expands to full screen
- "Next Set" button immediately tappable without extra clicks

### Issue #4: D1-D4 Labels
- Replaced Mon/Tue/Thu/Sat with D1/D2/D3/D4 since training days aren't fixed
- Removed cardio references from routine definitions

### Issue #5: Timezone Bug
- Removed strict date filter from session lookup — now searches by week_number + routine name
- Sessions found regardless of what day you open the app

### Issue #6: Auto-Advance at Timer Zero
- Timer auto-advances 2 seconds after hitting zero (allows chime to play)
- Uses `autoAdvancedRef` to prevent double-firing

### Issue #7: Meso Data Bleed
- `getLastSessionForExercise` now accepts `mesoPrefix` parameter
- Filters session history by current mesocycle (e.g. "Meso 1") so old program data doesn't pollute weight suggestions
- ExerciseCard passes `activeMeso.shortName` as the prefix

### Issue #8: Session Lookup Priority
- Changed session sort to prefer session with most logged sets, using today's date only as tiebreaker
- Fixes issue where empty auto-created sessions would be returned over older sessions with data

### Auto-Detect Next Routine
- On app load, queries last 5 completed sessions from Supabase
- Finds the last completed routine and advances to the next in cycle (Upper A → Lower A → Upper B → Lower B)
- Replaces unreliable localStorage approach

### Notes Field in Session Editor
- Added then removed — used temporarily to fix a session with missing notes
- Session editor has: Date, Duration, Week, RIR, Status

---

## Architecture

```
iPhone (PWA via Safari)
    ↓
React App (Vercel) — src/App.jsx is the entire app
    ↓
Supabase (Postgres DB) — data persists independently of app code
```

- App code changes = safe, data untouched
- `git push` triggers Vercel auto-deploy (~30 seconds)
- PWA may cache aggressively — delete and re-add from home screen to force update

---

## Development Workflow

```bash
# Navigate to project
cd /c/Users/"Blake Isom"/Downloads/training-hub

# Make edits (via node scripts or direct file editing)
node -e "const fs=require('fs'); ..."

# Or use heredoc for multi-line scripts
cat > /tmp/fix.js << 'EOF'
// script here
EOF
node /tmp/fix.js

# Verify changes
grep -n "search term" src/App.jsx

# Deploy
git add . && git commit -m "description" && git push
```

**Node.js v24.14.1** installed on this machine as of tonight.

---

## What's Next to Build

- **Analytics dashboard** — volume vs RP landmarks per muscle group per week
- **Progression charts** — weight over time per exercise
- **Body comp tracking** tab — integrate smart scale data
- **Session history browser** — filter by meso, routine, date range
- **Meso 2 programming** — build during Meso 1 deload week using real performance data

---

## Key Files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Entire React app (1838 lines) |
| `src/supabaseClient.js` | Supabase connection config |
| `src/index.js` | React entry point |
| `supabase-schema.sql` | Database schema |
| `migrate-history.sql` | ForceUSA workout history migration |
| `SETUP.md` | Deployment guide |
| `MASTER_BRIEF.md` | This file |

---

## Known Considerations

- **PWA caching on iOS** is aggressive — after pushing changes, may need to delete PWA and re-add from Safari
- **Smallest weight increment** on G3 is 5 lbs (2.5 lb plates per side) — upper body progression uses rep range first
- **Cable ratio** is 2:1 on the G3 — cable weight display should account for this (not yet implemented)
- **Dispatch/Cowork** was set up on work computer, causing conflicts with home computer — disable on work computer to fix
