-- ============================================================
-- Blake's Training Hub — Meso 1 Setup & Database Cleanup
-- Run in Supabase: Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- ============================================================
-- 1. BODY COMP BASELINE (April 1, 2026)
-- ============================================================
INSERT INTO body_comp (date, weight_lbs, body_fat_pct, lean_mass_lbs, fat_mass_lbs, resting_hr, notes)
VALUES ('2026-04-01', 205.4, 19.5, 165.3, 40.1, 55.4, 'Pre-Meso 1 baseline — InBody scan');

-- ============================================================
-- 2. CLEAN UP BAD SEED SESSIONS
-- (April 6 sessions that are in_progress with no routine assigned)
-- ============================================================
DELETE FROM sessions
WHERE date = '2026-04-06'
  AND status = 'in_progress'
  AND routine_id IS NULL;

-- ============================================================
-- 3. CREATE RP MESO 1 MESOCYCLE RECORD
-- ============================================================
INSERT INTO mesocycles (name, start_date, end_date, weeks, status, notes)
VALUES (
  'RP Mesocycle 1',
  '2026-04-13',
  '2026-05-24',
  6,
  'planned',
  '5 weeks accumulation + 1 deload. RIR: W1:4 → W2:3 → W3:2 → W4:2 → W5:0-1 → W6:4 (deload at 50% weight/sets). Preceded by RP deload week April 6-12.'
);

-- ============================================================
-- 4. CREATE ROUTINES FOR MESO 1
-- ============================================================
INSERT INTO routines (mesocycle_id, name, day_label, sort_order, cardio_note)
VALUES
  ((SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1'), 'Upper A', 'Mon', 1, '20-min incline walk post-workout'),
  ((SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1'), 'Lower A', 'Tue', 2, '10-min incline walk post-workout, target HR 125-135'),
  ((SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1'), 'Upper B', 'Thu', 3, '20-min incline walk post-workout'),
  ((SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1'), 'Lower B', 'Sat', 4, '10-min incline walk post-workout, target HR 125-135');

-- ============================================================
-- 5. ROUTINE EXERCISES — Upper A (Monday)
-- ============================================================
INSERT INTO routine_exercises
  (routine_id, exercise_id, sort_order, section_name, sets, rep_range, rest_seconds, base_weight, weight_increment, increment_frequency)
VALUES
  -- 1. Smith Flat Bench Press — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Flat Bench Press'),
   1, 'Chest', 3, '8-10', 150, 120, 2.5, 1),
  -- 2. Smith Incline Press (30°) — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Incline Press (30°)'),
   2, 'Chest', 3, '10-12', 120, 75, 2.5, 1),
  -- 3. Chin-Ups — bodyweight, no increment
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Chin-Ups (Wide Overhand)'),
   3, 'Back', 3, '6-10', 150, 0, 0, 1),
  -- 4. Seated Cable Row — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Seated Cable Row (Neutral)'),
   4, 'Back', 3, '10-12', 120, 140, 2.5, 1),
  -- 5. Cable Lateral Raise — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Lateral Raise'),
   5, 'Shoulders', 3, '12-15', 60, 15, 2.5, 2),
  -- 6. Cable Face Pull — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Face Pull (Rope)'),
   6, 'Shoulders', 3, '15-20', 60, 70, 2.5, 2),
  -- 7. Cable EZ Bar Curl — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable EZ Bar Curl'),
   7, 'Arms', 3, '10-12', 90, 65, 2.5, 2),
  -- 8. Cable OH Tricep Extension — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable OH Tricep Extension'),
   8, 'Arms', 3, '10-12', 90, 60, 2.5, 2);

-- ============================================================
-- 6. ROUTINE EXERCISES — Lower A (Tuesday)
-- ============================================================
INSERT INTO routine_exercises
  (routine_id, exercise_id, sort_order, section_name, sets, rep_range, rest_seconds, base_weight, weight_increment, increment_frequency)
VALUES
  -- 1. Smith Front Squat — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Lower A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Front Squat'),
   1, 'Quads', 3, '8-10', 150, 105, 2.5, 1),
  -- 2. Smith Stiff-Leg Deadlift — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Lower A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Stiff-Leg Deadlift'),
   2, 'Hamstrings', 3, '8-10', 150, 115, 2.5, 1),
  -- 3. Landmine Goblet Squat — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Lower A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Landmine Goblet Squat'),
   3, 'Quads', 3, '12-15', 90, 30, 2.5, 2),
  -- 4. Smith Deficit Calf Raise — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Lower A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Deficit Calf Raise'),
   4, 'Calves', 3, '12-15', 60, 115, 2.5, 2),
  -- 5. Cable Crunch — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Lower A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Crunch (Kneeling)'),
   5, 'Core', 3, '12-15', 60, 45, 2.5, 2),
  -- 6. Cable Upright Row — isolation, +2.5 every 2 weeks (2 sets)
  ((SELECT id FROM routines WHERE name = 'Lower A' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Upright Row'),
   6, 'Shoulders', 2, '12-15', 60, 40, 2.5, 2);

-- ============================================================
-- 7. ROUTINE EXERCISES — Upper B (Thursday)
-- ============================================================
INSERT INTO routine_exercises
  (routine_id, exercise_id, sort_order, section_name, sets, rep_range, rest_seconds, base_weight, weight_increment, increment_frequency)
VALUES
  -- 1. Smith Close-Grip Bench — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Close-Grip Bench'),
   1, 'Chest', 3, '8-10', 150, 75, 2.5, 1),
  -- 2. Cable Fly (Low-to-High) — isolation, +2.5 every 2 weeks (2 sets)
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Fly (Low-to-High)'),
   2, 'Chest', 2, '12-15', 90, 15, 2.5, 2),
  -- 3. Cable Lat Pulldown — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Lat Pulldown (Close)'),
   3, 'Back', 3, '10-12', 120, 180, 2.5, 1),
  -- 4. Landmine Row — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Landmine Row (Per Arm)'),
   4, 'Back', 3, '10-12', 90, 20, 2.5, 1),
  -- 5. Cable Cross-Body Lateral — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Cross-Body Lateral'),
   5, 'Shoulders', 3, '15-20', 60, 10, 2.5, 2),
  -- 6. Cable Rear Delt Fly — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Rear Delt Fly'),
   6, 'Shoulders', 3, '15-20', 60, 10, 2.5, 2),
  -- 7. Cable Bayesian Curl — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Bayesian Curl'),
   7, 'Arms', 3, '10-12', 90, 20, 2.5, 2),
  -- 8. Cable Pushdown (Bar) — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Upper B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Pushdown (Bar)'),
   8, 'Arms', 3, '10-12', 90, 65, 2.5, 2);

-- ============================================================
-- 8. ROUTINE EXERCISES — Lower B (Saturday)
-- ============================================================
INSERT INTO routine_exercises
  (routine_id, exercise_id, sort_order, section_name, sets, rep_range, rest_seconds, base_weight, weight_increment, increment_frequency)
VALUES
  -- 1. Smith Hack Squat — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Lower B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Hack Squat (Feet Fwd)'),
   1, 'Quads', 3, '10-12', 120, 95, 2.5, 1),
  -- 2. Smith Good Morning — compound, +2.5/week
  ((SELECT id FROM routines WHERE name = 'Lower B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Good Morning'),
   2, 'Hamstrings', 3, '10-12', 120, 75, 2.5, 1),
  -- 3. Smith Lunge (Front Elevated) — compound, +2.5 every 2 weeks (2 sets)
  ((SELECT id FROM routines WHERE name = 'Lower B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Lunge (Front Elevated)'),
   3, 'Glutes', 2, '12-15', 90, 40, 2.5, 2),
  -- 4. Smith Deficit Calf Raise — isolation, +2.5 every 2 weeks
  ((SELECT id FROM routines WHERE name = 'Lower B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Smith Deficit Calf Raise'),
   4, 'Calves', 3, '12-15', 60, 115, 2.5, 2),
  -- 5. Hanging Knee Raise — bodyweight, no increment
  ((SELECT id FROM routines WHERE name = 'Lower B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Hanging Knee Raise'),
   5, 'Core', 3, '12-15', 60, 0, 0, 1),
  -- 6. Cable Upright Row — isolation, +2.5 every 2 weeks (2 sets)
  ((SELECT id FROM routines WHERE name = 'Lower B' AND mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')),
   (SELECT id FROM exercises WHERE name = 'Cable Upright Row'),
   6, 'Shoulders', 2, '12-15', 60, 40, 2.5, 2);

-- ============================================================
-- VERIFY — Run these SELECT queries after to confirm setup
-- ============================================================
-- SELECT * FROM body_comp;
-- SELECT * FROM mesocycles WHERE name = 'RP Mesocycle 1';
-- SELECT r.name, count(re.id) as exercises FROM routines r
--   JOIN routine_exercises re ON re.routine_id = r.id
--   WHERE r.mesocycle_id = (SELECT id FROM mesocycles WHERE name = 'RP Mesocycle 1')
--   GROUP BY r.name;
