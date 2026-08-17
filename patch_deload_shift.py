#!/usr/bin/env python3
"""Shift Meso 3 -> Meso 4 boundary so deload week (Aug 17-23) runs the M4 structure.
Run: python3 patch_deload_shift.py && CI=true npm run build"""
P = "src/App.jsx"
src = open(P, encoding="utf-8").read()

old3 = '''    startDate: "2026-07-13",
    endDate: "2026-08-24",'''
new3 = '''    startDate: "2026-07-13",
    endDate: "2026-08-16",'''
assert src.count(old3) == 1, "Meso 3 date anchor"
src = src.replace(old3, new3)

old4 = '''    startDate: "2026-08-24",
    endDate: "2026-10-11",'''
new4 = '''    startDate: "2026-08-17",
    endDate: "2026-10-11",'''
assert src.count(old4) == 1, "Meso 4 date anchor"
src = src.replace(old4, new4)

open(P, "w", encoding="utf-8").write(src)
print("ok: Meso 3 ends 2026-08-16, Meso 4 active from 2026-08-17 (deload = M4 W6 this week)")
