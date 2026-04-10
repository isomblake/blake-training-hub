# Training Hub — Issue Tracker
**Updated:** April 9, 2026

---

## RESOLVED

### Issue #1: Rest Timer Audio in Background ✓
Background notification system added as fallback for iOS PWA audio suspension.

### Issue #2: Deload Rest Periods ✓
Rest auto-caps at 75s during deload weeks at display, logSet, and timer levels.

### Issue #3: Auto-Expand Timer at 10s ✓
Timer auto-expands from minimized to full screen at 10 seconds remaining.

### Issue #4: Day-of-Week Labels ✓
Replaced Mon/Tue/Thu/Sat with D1/D2/D3/D4. Removed cardio references.

### Issue #5: Timezone Date Bug ✓
Removed date filter from session lookup. Searches by week_number + routine name only.

### Issue #6: Auto-Advance at Zero ✓
Timer auto-advances 2 seconds after hitting zero.

### Issue #7: Meso Data Bleed ✓
Exercise history queries filtered by mesocycle prefix.

### Issue #8: Session Lookup Priority ✓
Sessions sorted by most logged sets first, today's date as tiebreaker only.

### Auto-Detect Next Routine ✓
Queries last completed session to determine which routine to show on app open.

---

## OPEN / MONITORING

- **PWA cache** — iOS aggressively caches the PWA. After deploys, may need to delete and re-add from home screen.
- **Lower A session (Apr 7)** — was manually fixed by adding notes via edit form. Monitor that future sessions auto-tag correctly.
- **Dispatch conflict** — work computer has Dispatch enabled, blocking home computer. Disable on work machine to fix.
