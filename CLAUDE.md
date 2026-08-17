# Blake Training Hub — project notes

## Equipment constraints
- Dumbbells available: **5, 10, 15, 20, 25, 30 lb only** (5-lb steps, max 30).
  Never program or auto-suggest a DB weight off that list. In App.jsx, exercises
  whose name starts with "DB " use `minStep = 5` (same as Smith) at every
  minStep derivation site — keep that invariant if adding new sites.
- Smith/barbell/carriage: 5-lb steps. Cables: 2.5-lb steps.

## Conventions
- All meso config lives in `src/App.jsx` (MESOCYCLES array + MESOX_ROUTINES objects).
- Live app deploys from `main` via Vercel. Blake's patch scripts (patch_*.py) assert
  unique anchors — if an assert fails, stop and report; never hand-edit around it.
- Verify with `CI=true npm run build` before committing.
- This cloud environment's network policy blocks *.supabase.co — backfill scripts
  must be run from Blake's machine (`node <script>` with `.env.local`).
