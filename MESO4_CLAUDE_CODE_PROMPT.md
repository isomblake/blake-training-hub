# MESO 4 IMPLEMENTATION — Claude Code prompt
Training Hub · blake-training-hub.vercel.app · apply during M3 deload week (Aug 17–23), live by Mon Aug 24. W4 D3/D4 shift past Bristol (Sep 17); deload sessions Oct 1–4; beach Oct 5–11 = rest.

## Paste this to Claude Code

> Read `MESO4_SPEC.md` for the programming rationale, then apply `patch_meso4.py`. Both files are in the repo root.
>
> Rules: `React.createElement`/JSX conventions already in `src/App.jsx` — do not restyle. Color keys are `C.txt / C.mut / C.card / C.bdr / C.grn / C.red / C.gld / C.blu / C.teal`. Do not touch Supabase schema, `makeDeloadRoutines`, the rest timer, push, or sound systems. Do not run any SQL. One commit.
>
> Steps:
> 1. `git pull` and confirm you're on the commit that has `MESO3_ROUTINES` at ~L973 and `const MESOCYCLES = [` at ~L1101. If not, stop and tell Blake.
> 2. `python3 patch_meso4.py` — it prints nine `ok` lines and asserts every anchor is unique. If any assert fails, stop; do not hand-edit around it — report the failing label.
> 3. `CI=true npm run build` — must pass with no warnings-as-errors.
> 4. `git add src/App.jsx patch_meso4.py MESO4_SPEC.md && git commit -m "Meso 4: 6-exercise sessions, collapsed meso strip, collapsed meso strip, addSets + calibrationWeeks fields, calibration-set excluded from auto-reduce" && git push`
> 5. Report back the build size line and the commit hash. Do nothing else.

## What the patch does (for review, not for Claude Code to re-implement)

| # | Change | Where |
|---|---|---|
| 1 | Inserts `MESO4_ROUTINES` (24 exercises, 6/day) before the deload-weeks comment | after MESO3_ROUTINES |
| 2 | Adds `rp-meso-4` to `MESOCYCLES` (2026-08-24 → 2026-10-11, standard `WEEKS`) | MESOCYCLES array |
| 3 | `totalSets = ex.sets + addedSets` where `addedSets` sums `ex.addSets[w]` for `w ≤ week+1`; deload still forces 2 | ExerciseCard |
| 4 | `calibrationActive` = `ex.calibration && (!ex.calibrationWeeks || calibrationWeeks.includes(week+1))`; banner keyed on it; new green banner when sets are added | ExerciseCard render |
| 5 | `saveSessionPerformance` also stores `avgWtX/avgRepsX` (excluding last set) | saveSessionPerformance |
| 6 | For `ex.calibration` exercises, `lsResult` uses `avgWtX/avgRepsX` and passes `null` for last-set RIR, so the to-failure set can't trigger "↓ Reduced" | ExerciseCard lsResult |
| 7 | DB fallback path slices off the last set for calibration exercises | ExerciseCard dbResult |
| 8 | Meso selector strip collapses older mesos: shows current + previous (and whichever is selected); a `‹` button expands the full list. Meso 0 stays hidden. No data change — all mesos still in History | App meso selector |
| 8 | Meso selector strip collapses older mesos: shows current + previous (and whichever is selected); a `‹` button expands the full list. Meso 0 stays hidden. No data change — all mesos still in History | App meso selector |

`week` is 0-indexed inside ExerciseCard; `addSets` and `calibrationWeeks` are 1-indexed (human week numbers) — the patch handles the +1.

## Verification on the live app (Blake, Monday)
- Meso 4 auto-selects (today ≥ Aug 24); Workout tab shows D1 Upper A with 6 exercises.
- D1: Bench 5×10-15 @120 rest 2:00 with the exhale/1-RIR note; Cable Lat Pulldown (Close) 5×8-12 @190 rest 2:00; DB Lateral Raise 3 @10 (+1 from W3); Face Pull 4 @72.5; EZ Curl 4 @50; OH Ext 3×10-15 @45 with the 📊 calibration banner (+1 from W3).
- D2: Leg Extension shows 3 sets W1–2, then "＋ 1 set added from W3 — 3 → 4" from W3; Cable Crunch shows "📊 … W1 RIR calibration set" in W1 only and nothing in W2+.
- D3: Incline 5 @80 (2:00), Row 5 @175 (2:00), Cable Cross-Body Lateral 3/arm @5 (+1 from W3), Cable Rear Delt Fly 4 @2.5 (with the rep-progression note), Bayesian 4 @22.5 (📊), Pushdown 3 @70 (+1 from W3). Upright rows on D2/D4 show the ROM note.
- D4: Back Squat @135, Calf @135, RDL @115, Hip Thrust @130 (+1 set from W3), Hanging Straight-Leg Raise 3×8-15 BW (first log auto-creates the exercise row), Upright Row @47.5.
- W6 deload: every exercise 2 sets, ~50% load, rest ≤75s (unchanged mechanism).
- Meso 3 history intact.
- Top strip shows `‹ · Meso 3 · Meso 4 ●`; tapping `‹` reveals Meso 1 and Meso 2; tapping any meso still loads it.
- Top strip shows `‹ · Meso 3 · Meso 4 ●`; tapping `‹` reveals Meso 1 and Meso 2; tapping any meso still loads it.

## Not in this patch (deliberate) — next sessions
- History tab redesign (push 2).
- Analytics tab: data-entry backfill (body_comp / health_daily) then design (push 3).
- No Supabase SQL. New exercise auto-inserts on first log via existing `getOrCreate` path.
- No superset/pairing UI (declined).
- No change to `WEEKS` banner text; the pressing `rirCap` code path stays in App.jsx but no M4 exercise sets it.
