"""
import_phase_delivery_dates.py — Set sim_dev_phases.date_dev_actual from historical CSV data.

Source: qrxPYM0C_03_Month.csv  (Access export: projection group × month)
Target: devdb.sim_dev_phases.date_dev_actual

The CSV has one row per projection group (development × lot-type × builder × etc.) per month.
Rows with LotsDeveloped > 0 indicate that lots in that development were delivered (developed) in
that month.  This script collapses to development × month, filters to past months only, and
assigns the resulting dates to phases in sequence_number order.

Matching rule:
  - Phases and CSV dates are both sorted chronologically (sequence_number / date ascending).
  - They are matched positionally: phase[0] → earliest CSV date, phase[1] → next, etc.
  - Phases that already have date_dev_actual set are skipped (not overwritten).
  - If there are more CSV dates than phases, excess dates are reported but ignored.
  - If there are more phases than CSV dates, trailing phases are left NULL.

Usage:
    python import_phase_delivery_dates.py           # dry run — no DB writes
    python import_phase_delivery_dates.py --apply   # write to DB
    python import_phase_delivery_dates.py --dev "Stonewater"   # single dev
"""

import argparse
import csv
import os
import sys
from collections import defaultdict
from datetime import date

import psycopg2
import psycopg2.extras

CSV_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "ReferenceFiles", "qrxPYM0C_03_Month.csv"
)
DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)


def load_csv_delivery_dates(csv_path: str, today: date) -> dict:
    """
    Parse the monthly CSV.  Returns {dev_name: [date, ...]} where each date
    is the first of a past month in which LotsDeveloped > 0.  Dates are sorted.
    """
    dev_months: dict = defaultdict(set)
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try:
                lots_dev = float(row.get("LotsDeveloped") or 0)
            except ValueError:
                continue
            if lots_dev <= 0:
                continue
            try:
                yr, mo = int(row["Year"]), int(row["MonthNo"])
                d = date(yr, mo, 1)
            except (KeyError, ValueError):
                continue
            if d < today:
                dev_months[row["Development"]].add(d)
    return {dev: sorted(months) for dev, months in dev_months.items()}


def load_dev_phases(cur, dev_id: int) -> list:
    """
    Return all phases for a development, ordered by sequence_number.
    Each row: {phase_id, phase_name, sequence_number, date_dev_actual}
    """
    cur.execute(
        """
        SELECT phase_id, phase_name, sequence_number, date_dev_actual
        FROM devdb.sim_dev_phases
        WHERE dev_id = %s
        ORDER BY sequence_number, phase_id
        """,
        (dev_id,),
    )
    return [dict(r) for r in cur.fetchall()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write to DB (default: dry run)")
    parser.add_argument("--dev", metavar="NAME", help="Limit to one development name")
    args = parser.parse_args()

    today = date.today()
    csv_path = os.path.abspath(CSV_PATH)

    if not os.path.exists(csv_path):
        print(f"ERROR: CSV not found: {csv_path}")
        sys.exit(1)

    dev_dates = load_csv_delivery_dates(csv_path, today)
    if args.dev:
        dev_dates = {k: v for k, v in dev_dates.items() if k == args.dev}
        if not dev_dates:
            print(f"ERROR: Development '{args.dev}' not found in CSV (or no past deliveries).")
            sys.exit(1)

    conn = psycopg2.connect(**DB)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Build name → dev_id lookup
    cur.execute("SELECT dev_id, dev_name FROM devdb.developments")
    name_to_id = {row["dev_name"]: row["dev_id"] for row in cur.fetchall()}

    total_assigned = 0
    total_skipped  = 0
    total_no_match = 0

    for dev_name in sorted(dev_dates):
        csv_delivery_dates = dev_dates[dev_name]

        if dev_name not in name_to_id:
            print(f"  WARN  '{dev_name}' — not found in developments table, skipping.")
            total_no_match += 1
            continue

        dev_id = name_to_id[dev_name]
        phases = load_dev_phases(cur, dev_id)

        if not phases:
            print(f"  WARN  '{dev_name}' — no phases found, skipping.")
            continue

        print(f"\n{dev_name}  ({len(phases)} phase(s), {len(csv_delivery_dates)} past CSV date(s))")

        assigned = 0
        skipped  = 0

        for i, (phase, csv_date) in enumerate(zip(phases, csv_delivery_dates)):
            if phase["date_dev_actual"] is not None:
                print(f"    ph.{phase['sequence_number']} '{phase['phase_name']}' — "
                      f"already set ({phase['date_dev_actual']}), skipping")
                skipped += 1
                continue

            action = "WRITE" if args.apply else "DRY"
            print(f"    ph.{phase['sequence_number']} '{phase['phase_name']}' — "
                  f"[{action}] date_dev_actual = {csv_date}")

            if args.apply:
                cur.execute(
                    "UPDATE devdb.sim_dev_phases SET date_dev_actual = %s, updated_at = NOW() "
                    "WHERE phase_id = %s",
                    (csv_date, phase["phase_id"]),
                )
            assigned += 1

        if len(csv_delivery_dates) > len(phases):
            excess = csv_delivery_dates[len(phases):]
            print(f"    NOTE: {len(excess)} excess CSV date(s) with no matching phase: "
                  f"{[str(d) for d in excess]}")

        if len(phases) > len(csv_delivery_dates):
            remaining = len(phases) - len(csv_delivery_dates)
            print(f"    NOTE: {remaining} phase(s) beyond CSV dates — left as NULL")

        total_assigned += assigned
        total_skipped  += skipped

    print(f"\n{'='*60}")
    print(f"Summary: {total_assigned} phase(s) {'updated' if args.apply else 'would be updated'}, "
          f"{total_skipped} already set (skipped), "
          f"{total_no_match} dev(s) not in DB.")

    if args.apply and total_assigned > 0:
        conn.commit()
        print("Committed.")
    elif not args.apply and total_assigned > 0:
        conn.rollback()
        print("Dry run — no changes written. Re-run with --apply to commit.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
