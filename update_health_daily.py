#!/usr/bin/env python3
"""
Apple Health -> health_daily upsert generator
=============================================
Usage:
  python3 update_health_daily.py export.csv [--since 2026-04-22]

Produces: update_health_daily_YYYY-MM-DD.sql
Paste that SQL into the Supabase SQL editor to refresh health_daily.

Input CSV format (from Apple Health export or a manual spreadsheet):
  date,steps,active_cal,exercise_min,distance_m,basal_cal,walking_hr,
  resting_hr,hrv_sdnn,flights_climbed,weight_kg,body_fat_pct,stand_min,vo2_max

All columns after 'date' are optional (leave blank for NULL).
Date must be ISO format: YYYY-MM-DD.
"""

import csv
import sys
import os
import argparse
from datetime import date, datetime


COLUMNS = [
    "date",
    "steps",
    "active_cal",
    "exercise_min",
    "distance_m",
    "basal_cal",
    "walking_hr",
    "resting_hr",
    "hrv_sdnn",
    "flights_climbed",
    "weight_kg",
    "body_fat_pct",
    "stand_min",
    "vo2_max",
]

NUMERIC_COLS = set(COLUMNS) - {"date"}


def fmt_val(col, raw):
    """Return SQL literal for a column value, or NULL."""
    v = raw.strip() if raw else ""
    if not v:
        return "NULL"
    if col in NUMERIC_COLS:
        try:
            float(v)
            return v
        except ValueError:
            return "NULL"
    # date
    return "'" + v.replace("'", "''") + "'"


def generate_sql(rows, since=None):
    lines = []
    lines.append("-- health_daily upsert generated " + date.today().isoformat())
    lines.append("-- Paste into Supabase SQL Editor\n")
    lines.append(
        "INSERT INTO health_daily (date,steps,active_cal,exercise_min,distance_m,"
        "basal_cal,walking_hr,resting_hr,hrv_sdnn,flights_climbed,weight_kg,"
        "body_fat_pct,stand_min,vo2_max) VALUES"
    )

    value_rows = []
    for row in rows:
        d = row.get("date", "").strip()
        if not d:
            continue
        if since and d < since:
            continue
        vals = [fmt_val(c, row.get(c, "")) for c in COLUMNS]
        value_rows.append("  (" + ", ".join(vals) + ")")

    if not value_rows:
        return None, 0

    lines.append(",\n".join(value_rows))
    lines.append(
        "ON CONFLICT (date) DO UPDATE SET\n"
        "  steps          = EXCLUDED.steps,\n"
        "  active_cal     = EXCLUDED.active_cal,\n"
        "  exercise_min   = EXCLUDED.exercise_min,\n"
        "  distance_m     = EXCLUDED.distance_m,\n"
        "  basal_cal      = EXCLUDED.basal_cal,\n"
        "  walking_hr     = EXCLUDED.walking_hr,\n"
        "  resting_hr     = EXCLUDED.resting_hr,\n"
        "  hrv_sdnn       = EXCLUDED.hrv_sdnn,\n"
        "  flights_climbed= EXCLUDED.flights_climbed,\n"
        "  weight_kg      = COALESCE(EXCLUDED.weight_kg, health_daily.weight_kg),\n"
        "  body_fat_pct   = COALESCE(EXCLUDED.body_fat_pct, health_daily.body_fat_pct),\n"
        "  stand_min      = EXCLUDED.stand_min,\n"
        "  vo2_max        = COALESCE(EXCLUDED.vo2_max, health_daily.vo2_max);"
    )
    return "\n".join(lines), len(value_rows)


def main():
    parser = argparse.ArgumentParser(description="Generate health_daily upsert SQL from CSV")
    parser.add_argument("csv_file", help="Path to input CSV")
    parser.add_argument("--since", default=None, help="Only include rows on or after this date (YYYY-MM-DD)")
    args = parser.parse_args()

    if not os.path.exists(args.csv_file):
        print("Error: file not found:", args.csv_file)
        sys.exit(1)

    with open(args.csv_file, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        # Normalise header names (lowercase, strip whitespace)
        reader.fieldnames = [h.strip().lower() for h in reader.fieldnames]
        rows = list(reader)

    sql, count = generate_sql(rows, since=args.since)
    if count == 0:
        print("No rows to insert (check --since date or CSV contents).")
        sys.exit(0)

    out_name = "update_health_daily_" + date.today().isoformat() + ".sql"
    with open(out_name, "w", encoding="utf-8") as f:
        f.write(sql)

    print("Wrote", count, "rows to", out_name)
    print("Paste that file into: Supabase > SQL Editor > New query")


if __name__ == "__main__":
    main()
