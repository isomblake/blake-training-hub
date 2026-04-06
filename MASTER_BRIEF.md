# Blake's Training Hub — Complete Project Context

## WHO IS BLAKE

- 6'3", 205.4 lbs, 19.5% BF, 165.3 lbs lean mass, 40.1 lbs fat mass, 55.4 bpm RHR
- Former ETSU track & field thrower, trained under sports scientists
- Goal: body recomposition (lose fat, build lean muscle) via RP hypertrophy principles
- Trains 4 days/week (Mon/Tue/Thu/Sat) on ForceUSA G3 all-in-one at home
- Training routine: 5-min flat walk warmup (3 mph), dynamic stretching, lifts, then 20-min incline walk upper days / 10-min lower days targeting 125-135 HR. Protein shake post-workout.
- Started conservative on weights after time away from training

## BODY COMP TARGETS

| Metric | Current (Apr 1) | Short-Term | Long-Term |
|--------|----------------|------------|-----------|
| Weight | 205.4 lbs | 200-205 | 195-200 |
| Body Fat | 19.5% | 17-18% | 14-15% |
| Lean Mass | 165.3 lbs | 165-168 | 168-172 |
| Fat Mass | 40.1 lbs | 34-36 | 28-30 |
| RHR | 55.4 bpm | <55 | <52 |

## EQUIPMENT

**ForceUSA G3**: Smith machine (1:1 ratio), dual cable system (2:1 pulley ratio), landmine, chin-up bar

**Weight tracking convention**: All weights logged as PLATES LOADED on the machine
- Smith machine: plates loaded = weight felt (1:1)
- Cables: plates loaded = 2x what you feel at handle (2:1 ratio). Load 80 = feel 40.
- Landmine: plates added only (bar weight not included)
- The system handles ratio math internally for analytics; Blake always sees/enters plate weight

---

## APP ARCHITECTURE

```
Phone/Computer (Browser) -> opens URL like blake-training-hub.vercel.app
    |
React App (Vercel) <- single App.jsx, iterated in Claude chats
    |
Supabase (Postgres DB) <- data permanent, separate from app code
```

- App code changes = safe, data untouched
- Database = permanent, backed up by Supabase
- Update flow: modify App.jsx -> git push -> Vercel auto-deploys in 30s -> phone sees new version

## DATABASE SCHEMA (9 tables in Supabase)

### exercises
- id (uuid PK), name (unique), muscles, equipment (Smith/Cable/Landmine/Bodyweight), movement_type (compound/isolation), muscle_group (for volume tracking), cable_ratio (1 or 2), vid_url, vid_source, created_at

### mesocycles
- id (uuid PK), name, start_date, end_date, weeks (default 6), status (active/completed/planned), notes

### routines
- id (uuid PK), mesocycle_id (FK), name (Upper A, Lower A, etc.), day_label, sort_order, cardio_note

### routine_exercises
- id (uuid PK), routine_id (FK), exercise_id (FK), sort_order, section_name, sets, rep_range, rest_seconds, base_weight, weight_increment, increment_frequency, notes

### sessions
- id (uuid PK), date, routine_id (FK), mesocycle_id (FK), week_number, rir, status (completed/skipped/partial), duration_minutes, notes

### sets
- id (uuid PK), session_id (FK), exercise_id (FK), set_number, reps, weight (plates loaded), rest_seconds, set_duration_seconds, rpe, notes

### body_comp
- id (uuid PK), date, weight_lbs, body_fat_pct, lean_mass_lbs, fat_mass_lbs, resting_hr, waist_inches, notes

### muscle_volume
- id (uuid PK), mesocycle_id (FK), week_number, muscle_group, hard_sets, total_reps, avg_weight, total_volume, mev, mav, mrv

### volume_landmarks (RP reference data, seeded)
- muscle_group, mev_sets, mav_sets, mrv_sets, mrv_recomp, freq_per_week, notes

---

## RP VOLUME LANDMARKS (deficit-adjusted for recomp)

| Muscle Group | MEV | MAV | MRV | MRV Recomp | Freq | Notes |
|-------------|-----|-----|-----|------------|------|-------|
| chest | 8 | 12 | 20 | 16 | 2x | Flat + incline covers both heads |
| lats | 8 | 14 | 20 | 16 | 2x | Vertical + horizontal pull |
| upper_back | 6 | 10 | 18 | 14 | 2x | Rows, face pulls |
| side_delts | 8 | 16 | 26 | 20 | 2x | Recover fast, high frequency ok |
| rear_delts | 6 | 10 | 18 | 14 | 2x | Face pulls, reverse flies |
| biceps | 6 | 12 | 20 | 16 | 2x | Recover fast, can hit 3x/week |
| triceps | 6 | 10 | 18 | 14 | 2x | Get indirect work from pressing |
| quads | 6 | 12 | 18 | 14 | 2x | Squats + leg press variations |
| hamstrings | 4 | 10 | 16 | 12 | 2x | RDLs + curls |
| glutes | 0 | 4 | 12 | 8 | 2x | Often hit indirectly by squats/DLs |
| calves | 6 | 10 | 16 | 12 | 2x | Need high frequency |
| abs | 0 | 6 | 16 | 12 | 2x | Cable crunches + hanging raises |
| forearms | 0 | 4 | 12 | 8 | 1x | Get indirect work from pulling |

## RP KEY PRINCIPLES

1. **Volume drives hypertrophy** - more sets = more growth, up to MRV
2. **Start at MEV, progress to MRV** - never start at max volume
3. **RIR 4->0 across mesocycle** - save max effort for final week
4. **SFR governs exercise selection** - Smith/cables beat free barbells for hypertrophy (stimulus-to-fatigue ratio)
5. **Recomp lowers MRV by ~4-6 sets/muscle/wk** - reduced recovery in deficit
6. **Deload is non-negotiable** - dump fatigue to enable next meso's growth
7. **Track, assess, adjust** - Set Progression Algorithm turns feedback into volume changes
8. **Protein is #1** - 1.2-1.45 g/lb during recomp (245-295g/day for Blake)

## RP SET PROGRESSION ALGORITHM (for mid-workout adjustments)

When Blake adjusts weight mid-workout, the app should:
- If he INCREASES weight beyond target: next week's target for that exercise increases proportionally
- If he DECREASES weight below target: flag it but don't auto-reduce (could be fatigue, bad day)
- If he ADDS a set beyond programmed: count toward volume, suggest maintaining that set count next week
- If he DROPS a set: flag potential recovery issue, suggest checking if volume is approaching MRV
- Track actual vs programmed for each exercise across weeks to identify trends
- Auto-suggest weight for next session based on: previous actual weight + weekly increment rule

### Weight Progression Rules
- Compounds: +2.5 lb/week
- Isolations: +2.5 lb every 2 weeks
- If all reps hit at target RIR -> proceed with increment
- If reps drop below range -> hold weight, don't increment
- If reps exceed range -> bump weight by extra 2.5 lb

---

## DELOAD WEEK (April 6–12, 2026)

RP deload following 8 weeks of Sculpted Strength before starting Meso 1.
- Same exercises and split as Meso 1
- **2 sets per exercise** (instead of 3)
- **50% of Meso 1 Week 1 base weights**
- RIR 4+ — should feel very easy, just moving blood
- No cardio requirement (keep walks optional/easy)

| Day | Routine | Deload Weights |
|-----|---------|---------------|
| Mon Apr 6 | Upper A | Bench 60, Incline 40, Chin-Ups BW, Row 70, Laterals 10, Face Pull 35, Curl 35, OH Tri 30 |
| Tue Apr 7 | Lower A | Front Squat 55, SLDL 60, Goblet Squat 15, Calf Raise 60, Cable Crunch 25, Upright Row 20 |
| Thu Apr 9 | Upper B | CG Bench 40, Cable Fly 10, Pulldown 90, LM Row 10, CB Lateral 5, RD Fly 5, Bayesian 10, Pushdown 35 |
| Sat Apr 12 | Lower B | Hack Squat 50, Good Morning 40, Lunge 20, Calf Raise 60, Knee Raise BW, Upright Row 20 |

---

## CURRENT MESOCYCLE: RP Meso 1 (Starts April 13, 2026)

### Parameters
- Split: Upper A (Mon) / Lower A (Tue) / Upper B (Thu) / Lower B (Sat)
- Duration: 5 weeks accumulation + 1 week deload
- Start: April 13, 2026 | End: May 24, 2026
- RIR: W1:4 -> W2:3 -> W3:2 -> W4:2 -> W5:0-1 -> W6:4 (deload)
- Deload: 50% weight, 50% sets

### Volume Redistribution (the core fix from Phase 2)
| Muscle | Was | Now (W1) | Change | Rationale |
|--------|-----|----------|--------|-----------|
| Biceps | 3.9 | 8 | +105% | Was 50% below MEV; cable curls both upper days |
| Side Delts | 4.8 | 10 | +108% | Below MEV; laterals + upright rows |
| Lats | 5.5 | 10 | +82% | 45% below MEV; chin-ups + pulldowns |
| Rear Delts | 4.0 | 6 | +50% | Low end MEV; face pulls + flies |
| Calves | 4.8 | 6 | +25% | Near MEV floor; deficit raises both lower days |
| Glutes | 25.9 | 8 | -69% | Above MRV; RP says can be 0 with deep squats + SLDLs |
| Abs | 0 | 6 | NEW | Was absent; cable crunches + hanging raises |

---

## COMPLETE ROUTINE PROGRAMMING (all weights = plates loaded)

### Upper A (Monday) - Post: 20-min incline walk
| # | Exercise | Sets x Reps | W1 Weight | Rest | Muscles | Muscle Group |
|---|----------|-------------|-----------|------|---------|-------------|
| 1 | Smith Flat Bench Press | 3x8-10 | 120 | 2:30 | Chest | chest |
| 2 | Smith Incline Press (30) | 3x10-12 | 75 | 2:00 | Upper Chest | chest |
| 3 | Chin-Ups (Wide Overhand) | 3x6-10 | BW | 2:30 | Lats / Upper Back | lats |
| 4 | Seated Cable Row (Neutral) | 3x10-12 | 140 | 2:00 | Upper Back / Lats | upper_back |
| 5 | Cable Lateral Raise | 3x12-15 | 15 | 1:00 | Side Delts | side_delts |
| 6 | Cable Face Pull (Rope) | 3x15-20 | 70 | 1:00 | Rear Delts | rear_delts |
| 7 | Cable EZ Bar Curl | 3x10-12 | 65 | 1:30 | Biceps | biceps |
| 8 | Cable OH Tricep Extension | 3x10-12 | 60 | 1:30 | Triceps | triceps |

### Lower A (Tuesday) - Post: 10-min incline walk
| # | Exercise | Sets x Reps | W1 Weight | Rest | Muscles | Muscle Group |
|---|----------|-------------|-----------|------|---------|-------------|
| 1 | Smith Front Squat | 3x8-10 | 105 | 2:30 | Quads / Glutes | quads |
| 2 | Smith Stiff-Leg Deadlift | 3x8-10 | 115 | 2:30 | Hams / Glutes | hamstrings |
| 3 | Landmine Goblet Squat | 3x12-15 | 30 | 1:30 | Quads / Glutes | quads |
| 4 | Smith Deficit Calf Raise | 3x12-15 | 115 | 1:00 | Calves | calves |
| 5 | Cable Crunch (Kneeling) | 3x12-15 | 45 | 1:00 | Abs | abs |
| 6 | Cable Upright Row | 2x12-15 | 40 | 1:00 | Side Delts | side_delts |

### Upper B (Thursday) - Post: 20-min incline walk
| # | Exercise | Sets x Reps | W1 Weight | Rest | Muscles | Muscle Group |
|---|----------|-------------|-----------|------|---------|-------------|
| 1 | Smith Close-Grip Bench | 3x8-10 | 75 | 2:30 | Chest / Triceps | chest |
| 2 | Cable Fly (Low-to-High) | 2x12-15 | 15 | 1:30 | Chest | chest |
| 3 | Cable Lat Pulldown (Close) | 3x10-12 | 180 | 2:00 | Lats | lats |
| 4 | Landmine Row (Per Arm) | 3x10-12 | 20 | 1:30 | Upper Back / Lats | upper_back |
| 5 | Cable Cross-Body Lateral | 3x15-20 | 10 | 1:00 | Side Delts | side_delts |
| 6 | Cable Rear Delt Fly | 3x15-20 | 10 | 1:00 | Rear Delts | rear_delts |
| 7 | Cable Bayesian Curl | 3x10-12 | 20/arm | 1:30 | Biceps | biceps |
| 8 | Cable Pushdown (Bar) | 3x10-12 | 65 | 1:30 | Triceps | triceps |

### Lower B (Saturday) - Post: 10-min incline walk
| # | Exercise | Sets x Reps | W1 Weight | Rest | Muscles | Muscle Group |
|---|----------|-------------|-----------|------|---------|-------------|
| 1 | Smith Hack Squat (Feet Fwd) | 3x10-12 | 95 | 2:00 | Quads | quads |
| 2 | Smith Good Morning | 3x10-12 | 75 | 2:00 | Hams / Glutes | hamstrings |
| 3 | Smith Lunge (Front Elevated) | 2x12-15 | 40/leg | 1:30 | Glutes / Quads | glutes |
| 4 | Smith Deficit Calf Raise | 3x12-15 | 115 | 1:00 | Calves | calves |
| 5 | Hanging Knee Raise | 3x12-15 | BW | 1:00 | Abs | abs |
| 6 | Cable Upright Row | 2x12-15 | 40 | 1:00 | Side Delts | side_delts |

---

## WEEKLY VOLUME BY MUSCLE GROUP (Meso 1, Week 1)

| Muscle Group | Sets/Week | vs MEV | vs MRV Recomp | Status |
|-------------|-----------|--------|---------------|--------|
| Chest | 11 | +3 above MEV | 5 below MRV | Good |
| Lats | 10 | +2 above MEV | 6 below MRV | Good |
| Upper Back | 6 | at MEV | 8 below MRV | Room to grow |
| Side Delts | 10 | +2 above MEV | 10 below MRV | Good |
| Rear Delts | 6 | at MEV | 8 below MRV | Room to grow |
| Biceps | 8 | +2 above MEV | 8 below MRV | Good |
| Triceps | 6 | at MEV | 8 below MRV | OK - gets indirect from pressing |
| Quads | 12 | +6 above MEV | 2 below MRV | Near ceiling - monitor |
| Hamstrings | 6 | +2 above MEV | 6 below MRV | Good |
| Glutes | 2 | +2 above MEV | 6 below MRV | Intentionally low |
| Calves | 6 | at MEV | 6 below MRV | Good |
| Abs | 6 | +6 above MEV | 6 below MRV | Good |

---

## HISTORICAL DATA (in database)

### Programs
- **Natural Strength**: 1 session (Jan 17, 2026) - intro/orientation
- **Starting Strength**: 9 sessions (Jan 19 - Feb 7) - 3x/week full body
- **Sculpted Strength**: 32 sessions (Feb 9 - Apr 4) - 4x/week split, 8 weeks
- **RP Deload**: Apr 6-12 - 2 sets, 50% weight, same Meso 1 exercises
- **RP Meso 1**: Starts Apr 13 - 5 weeks accumulation + 1 deload

### Database Stats
- 42 sessions total
- 971 individual sets
- 60 unique exercises
- Date range: Jan 17 - Apr 4, 2026

---

## SUPABASE CONNECTION INFO

- Project: Blake's RP
- URL: https://bahpdsjlshwphqjdxusi.supabase.co
- Anon key: stored in .env.local (REACT_APP_SUPABASE_ANON_KEY)

## WEEK PROGRESSION LOGIC

- W1: 4 RIR, base weight
- W2: 3 RIR, +2.5 lb compounds
- W3: 2 RIR, +5 lb compounds
- W4: 2 RIR, +7.5 lb compounds
- W5: 0-1 RIR, +10 lb compounds
- W6: 4 RIR DELOAD, 50% weight, 50% sets
- Isolations get half the increment, rounded to nearest 2.5
