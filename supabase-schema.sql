-- ============================================================
-- BLAKE'S TRAINING HUB — Supabase Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. EXERCISES — Master exercise library
-- ============================================================
create table exercises (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  muscles text,                    -- "Chest", "Lats · Upper Back"
  equipment text,                  -- "Smith", "Cable", "Landmine", "Bodyweight"
  movement_type text,              -- "compound", "isolation"
  muscle_group text,               -- Primary group for volume tracking: "chest", "back_lats", "side_delts", etc.
  cable_ratio numeric default 1,   -- 2 for cables (2:1 pulley), 1 for smith/landmine
  vid_url text,
  vid_source text,
  created_at timestamptz default now()
);

-- ============================================================
-- 2. MESOCYCLES — Programming blocks
-- ============================================================
create table mesocycles (
  id uuid primary key default uuid_generate_v4(),
  name text not null,              -- "RP Mesocycle 1", "ForceUSA Natural Strength"
  start_date date,
  end_date date,
  weeks integer default 6,         -- 5 accumulation + 1 deload
  status text default 'active',    -- "active", "completed", "planned"
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- 3. ROUTINES — Workout templates within a mesocycle
-- ============================================================
create table routines (
  id uuid primary key default uuid_generate_v4(),
  mesocycle_id uuid references mesocycles(id),
  name text not null,              -- "Upper A", "Lower A"
  day_label text,                  -- "Mon", "Tue", etc.
  sort_order integer default 0,
  cardio_note text,                -- "20-min incline walk"
  created_at timestamptz default now()
);

-- ============================================================
-- 4. ROUTINE_EXERCISES — Exercises within a routine (programming)
-- ============================================================
create table routine_exercises (
  id uuid primary key default uuid_generate_v4(),
  routine_id uuid references routines(id) on delete cascade,
  exercise_id uuid references exercises(id),
  sort_order integer default 0,
  section_name text,               -- "Chest", "Back", "Arms"
  sets integer default 3,
  rep_range text,                  -- "8-10", "12-15"
  rest_seconds integer default 90,
  base_weight numeric,             -- W1 starting weight (plates loaded)
  weight_increment numeric default 2.5, -- Per week
  increment_frequency integer default 1, -- Every N weeks (2 for isolations)
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- 5. SESSIONS — Actual workout sessions
-- ============================================================
create table sessions (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  routine_id uuid references routines(id),
  mesocycle_id uuid references mesocycles(id),
  week_number integer,             -- 1-6
  rir text,                        -- "4 RIR", "3 RIR", "0-1 RIR"
  status text default 'completed', -- "completed", "skipped", "partial"
  duration_minutes integer,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- 6. SETS — Individual logged sets (the core data)
-- ============================================================
create table sets (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid references sessions(id) on delete cascade,
  exercise_id uuid references exercises(id),
  set_number integer not null,
  reps integer not null,
  weight numeric not null,         -- Always plates loaded
  rest_seconds integer,            -- Actual rest taken
  set_duration_seconds integer,    -- How long the set took
  rpe numeric,                     -- Rate of perceived exertion (optional)
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- 7. BODY_COMP — Body composition tracking
-- ============================================================
create table body_comp (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  weight_lbs numeric,
  body_fat_pct numeric,
  lean_mass_lbs numeric,
  fat_mass_lbs numeric,
  resting_hr numeric,
  waist_inches numeric,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- 8. MUSCLE_VOLUME — Weekly volume tracking per muscle group
--    (auto-calculated, but stored for history)
-- ============================================================
create table muscle_volume (
  id uuid primary key default uuid_generate_v4(),
  mesocycle_id uuid references mesocycles(id),
  week_number integer,
  muscle_group text not null,      -- "chest", "lats", "side_delts", "biceps", etc.
  hard_sets integer default 0,     -- Sets within 0-4 RIR
  total_reps integer default 0,
  avg_weight numeric,
  total_volume numeric,            -- sets * reps * weight
  mev integer,                     -- Minimum Effective Volume target
  mav integer,                     -- Maximum Adaptive Volume target  
  mrv integer,                     -- Maximum Recoverable Volume target
  created_at timestamptz default now()
);

-- ============================================================
-- 9. RP VOLUME LANDMARKS — Reference data for programming
-- ============================================================
create table volume_landmarks (
  id uuid primary key default uuid_generate_v4(),
  muscle_group text not null unique,
  mev_sets integer,                -- Minimum Effective Volume (sets/week)
  mav_sets integer,                -- Maximum Adaptive Volume
  mrv_sets integer,                -- Maximum Recoverable Volume
  mrv_recomp integer,              -- MRV adjusted for deficit (-4 to -6)
  freq_per_week integer default 2, -- Optimal frequency
  notes text
);

-- Insert RP volume landmarks (deficit-adjusted for recomp)
insert into volume_landmarks (muscle_group, mev_sets, mav_sets, mrv_sets, mrv_recomp, freq_per_week, notes) values
  ('chest',      8,  12, 20, 16, 2, 'Flat + incline covers both heads'),
  ('lats',       8,  14, 20, 16, 2, 'Vertical + horizontal pull'),
  ('upper_back', 6,  10, 18, 14, 2, 'Rows, face pulls'),
  ('side_delts', 8,  16, 26, 20, 2, 'Recover fast, high frequency ok'),
  ('rear_delts', 6,  10, 18, 14, 2, 'Face pulls, reverse flies'),
  ('biceps',     6,  12, 20, 16, 2, 'Recover fast, can hit 3x/week'),
  ('triceps',    6,  10, 18, 14, 2, 'Get indirect work from pressing'),
  ('quads',      6,  12, 18, 14, 2, 'Squats + leg press variations'),
  ('hamstrings', 4,  10, 16, 12, 2, 'RDLs + curls'),
  ('glutes',     0,   4, 12,  8, 2, 'Often hit indirectly by squats/DLs'),
  ('calves',     6,  10, 16, 12, 2, 'Need high frequency'),
  ('abs',        0,   6, 16, 12, 2, 'Cable crunches + hanging raises'),
  ('forearms',   0,   4, 12,  8, 1, 'Get indirect work from pulling');

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index idx_sets_session on sets(session_id);
create index idx_sets_exercise on sets(exercise_id);
create index idx_sessions_date on sessions(date);
create index idx_sessions_meso on sessions(mesocycle_id);
create index idx_body_comp_date on body_comp(date);
create index idx_muscle_volume_meso_week on muscle_volume(mesocycle_id, week_number);

-- ============================================================
-- ROW LEVEL SECURITY (Supabase requirement)
-- For single-user app, allow all authenticated access
-- ============================================================
alter table exercises enable row level security;
alter table mesocycles enable row level security;
alter table routines enable row level security;
alter table routine_exercises enable row level security;
alter table sessions enable row level security;
alter table sets enable row level security;
alter table body_comp enable row level security;
alter table muscle_volume enable row level security;
alter table volume_landmarks enable row level security;

-- Allow all operations for authenticated users
-- (Single-user app, so this is fine)
create policy "Allow all" on exercises for all using (true) with check (true);
create policy "Allow all" on mesocycles for all using (true) with check (true);
create policy "Allow all" on routines for all using (true) with check (true);
create policy "Allow all" on routine_exercises for all using (true) with check (true);
create policy "Allow all" on sessions for all using (true) with check (true);
create policy "Allow all" on sets for all using (true) with check (true);
create policy "Allow all" on body_comp for all using (true) with check (true);
create policy "Allow all" on muscle_volume for all using (true) with check (true);
create policy "Allow all" on volume_landmarks for all using (true) with check (true);

-- ============================================================
-- SEED: RP Mesocycle 1 Exercises
-- ============================================================
insert into exercises (name, muscles, equipment, movement_type, muscle_group, cable_ratio, vid_url, vid_source) values
  ('Smith Flat Bench Press', 'Chest', 'Smith', 'compound', 'chest', 1, 'https://www.muscleandstrength.com/exercises/smith-machine-bench-press.html', 'M&S'),
  ('Smith Incline Press (30°)', 'Upper Chest', 'Smith', 'compound', 'chest', 1, 'https://www.muscleandstrength.com/exercises/incline-smith-machine-bench-press.html', 'M&S'),
  ('Chin-Ups (Wide Overhand)', 'Lats · Upper Back', 'Bodyweight', 'compound', 'lats', 1, 'https://www.muscleandstrength.com/exercises/wide-grip-pull-up.html', 'M&S'),
  ('Seated Cable Row (Neutral)', 'Upper Back · Lats', 'Cable', 'compound', 'upper_back', 2, 'https://www.muscleandstrength.com/exercises/seated-row.html', 'M&S'),
  ('Cable Lateral Raise', 'Side Delts', 'Cable', 'isolation', 'side_delts', 2, 'https://www.muscleandstrength.com/exercises/two-arm-cable-lateral-raise.html', 'M&S'),
  ('Cable Face Pull (Rope)', 'Rear Delts', 'Cable', 'isolation', 'rear_delts', 2, 'https://www.muscleandstrength.com/exercises/cable-face-pull', 'M&S'),
  ('Cable EZ Bar Curl', 'Biceps', 'Cable', 'isolation', 'biceps', 2, 'https://www.muscleandstrength.com/exercises/cable-curl.html', 'M&S'),
  ('Cable OH Tricep Extension', 'Triceps', 'Cable', 'isolation', 'triceps', 2, 'https://www.muscleandstrength.com/exercises/standing-low-pulley-overhead-tricep-extension-(rope-extension).html', 'M&S'),
  ('Smith Front Squat', 'Quads · Glutes', 'Smith', 'compound', 'quads', 1, 'https://www.muscleandstrength.com/exercises/smith-machine-front-squat.html', 'M&S'),
  ('Smith Stiff-Leg Deadlift', 'Hams · Glutes', 'Smith', 'compound', 'hamstrings', 1, 'https://www.muscleandstrength.com/exercises/smith-machine-stiff-leg-deadlift.html', 'M&S'),
  ('Landmine Goblet Squat', 'Quads · Glutes', 'Landmine', 'compound', 'quads', 1, 'https://www.muscleandstrength.com/exercises/landmine-goblet-squat', 'M&S'),
  ('Smith Deficit Calf Raise', 'Calves', 'Smith', 'isolation', 'calves', 1, 'https://www.muscleandstrength.com/exercises/smith-machine-calf-raise.html', 'M&S'),
  ('Cable Crunch (Kneeling)', 'Abs', 'Cable', 'isolation', 'abs', 2, 'https://www.muscleandstrength.com/exercises/cable-crunch.html', 'M&S'),
  ('Cable Upright Row', 'Side Delts', 'Cable', 'compound', 'side_delts', 2, 'https://www.muscleandstrength.com/exercises/cable-upright-row.html', 'M&S'),
  ('Smith Close-Grip Bench', 'Chest · Triceps', 'Smith', 'compound', 'chest', 1, 'https://www.muscleandstrength.com/exercises/smith-machine-close-grip-bench-press.html', 'M&S'),
  ('Cable Fly (Low-to-High)', 'Chest', 'Cable', 'isolation', 'chest', 2, 'https://www.muscleandstrength.com/exercises/cable-lower-chest-raise.html', 'M&S'),
  ('Cable Lat Pulldown (Close)', 'Lats', 'Cable', 'compound', 'lats', 2, 'https://www.muscleandstrength.com/exercises/close-grip-pull-down.html', 'M&S'),
  ('Landmine Row (Per Arm)', 'Upper Back · Lats', 'Landmine', 'compound', 'upper_back', 1, 'https://www.muscleandstrength.com/exercises/one-arm-bent-over-row.html', 'M&S'),
  ('Cable Cross-Body Lateral', 'Side Delts', 'Cable', 'isolation', 'side_delts', 2, 'https://www.muscleandstrength.com/exercises/one-arm-cable-lateral-raise.html', 'M&S'),
  ('Cable Rear Delt Fly', 'Rear Delts', 'Cable', 'isolation', 'rear_delts', 2, 'https://www.muscleandstrength.com/exercises/standing-cable-flys.html', 'M&S'),
  ('Cable Bayesian Curl', 'Biceps', 'Cable', 'isolation', 'biceps', 2, 'https://barbend.com/bayesian-curl/', 'BarBend'),
  ('Cable Pushdown (Bar)', 'Triceps', 'Cable', 'isolation', 'triceps', 2, 'https://www.muscleandstrength.com/exercises/tricep-extension.html', 'M&S'),
  ('Smith Hack Squat (Feet Fwd)', 'Quads', 'Smith', 'compound', 'quads', 1, 'https://www.muscleandstrength.com/exercises/feet-forward-smith-machine-squat.html', 'M&S'),
  ('Smith Good Morning', 'Hams · Glutes', 'Smith', 'compound', 'hamstrings', 1, 'https://www.tiktok.com/@drmikeisraetel/video/7340302191909031211', 'Dr. Mike'),
  ('Smith Lunge (Front Elevated)', 'Glutes · Quads', 'Smith', 'compound', 'glutes', 1, 'https://www.muscleandstrength.com/exercises/front-foot-elevated-smith-machine-split-squat', 'M&S'),
  ('Hanging Knee Raise', 'Abs', 'Bodyweight', 'isolation', 'abs', 1, 'https://www.muscleandstrength.com/exercises/hanging-knee-raise.html', 'M&S');

-- ============================================================
-- SEED: Historical exercises from ForceUSA programs
-- (These will be needed when migrating old data)
-- ============================================================
insert into exercises (name, muscles, equipment, movement_type, muscle_group, cable_ratio) values
  ('Seated Lat Pulldown', 'Lats', 'Cable', 'compound', 'lats', 2),
  ('Barbell Push Press', 'Shoulders', 'Smith', 'compound', 'side_delts', 1),
  ('Standing Lat Pulldown', 'Lats', 'Cable', 'compound', 'lats', 2),
  ('Smith Machine Squat', 'Quads · Glutes', 'Smith', 'compound', 'quads', 1),
  ('Smith Machine Deadlift', 'Back · Hams', 'Smith', 'compound', 'hamstrings', 1),
  ('Smith Machine Shoulder Press', 'Shoulders', 'Smith', 'compound', 'side_delts', 1),
  ('Cable Bicep Curl', 'Biceps', 'Cable', 'isolation', 'biceps', 2),
  ('Cable Tricep Extension', 'Triceps', 'Cable', 'isolation', 'triceps', 2),
  ('Cable Upright Row Standard Grip', 'Side Delts', 'Cable', 'compound', 'side_delts', 2),
  ('Landmine 1/2 Kneeling Press Left', 'Shoulders', 'Landmine', 'compound', 'side_delts', 1),
  ('Landmine 1/2 Kneeling Press Right', 'Shoulders', 'Landmine', 'compound', 'side_delts', 1),
  ('Landmine Single Arm Bent Over Row - Left', 'Upper Back', 'Landmine', 'compound', 'upper_back', 1),
  ('Landmine Single Arm Bent Over Row - Right', 'Upper Back', 'Landmine', 'compound', 'upper_back', 1),
  ('Smith Machine Bench Press', 'Chest', 'Smith', 'compound', 'chest', 1),
  ('Smith Machine Incline Bench Press', 'Upper Chest', 'Smith', 'compound', 'chest', 1),
  ('Single Leg Squat Left', 'Quads', 'Smith', 'compound', 'quads', 1),
  ('Single Leg Squat Right', 'Quads', 'Smith', 'compound', 'quads', 1)
on conflict (name) do nothing;
