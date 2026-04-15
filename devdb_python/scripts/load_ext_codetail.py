"""
load_ext_codetail.py
Load codetail.csv into devdb_ext.codetail (truncate + reload).

Source: ReferenceFiles/csv exports/codetail.csv  (MARKS option/cost detail per lot)
Target: devdb_ext.codetail
PK: (companycode, developmentcode, housenumber, conumber, adddeleteflag, optioncode)

Note: adddeleteflag is always empty string in source data; stored as '' not NULL.

Usage:
  python load_ext_codetail.py [--csv PATH] [--dry-run]
"""

import argparse
import csv
import os
from decimal import Decimal, InvalidOperation

import psycopg2
import psycopg2.extras

DEFAULT_CSV = os.path.join(
    os.path.dirname(__file__), "..", "..", "ReferenceFiles", "csv exports", "codetail.csv"
)
DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)
CHUNK = 5_000


def _s(v):
    """String: empty → None."""
    v = (v or "").strip()
    return v or None


def _pk(v):
    """PK string: strip only, keep empty string (never None)."""
    return (v or "").strip()


def _i(v):
    v = (v or "").strip()
    try:
        return int(v)
    except ValueError:
        return None


def _n(v):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def load_csv(csv_path):
    rows = []
    skipped = 0
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc  = _pk(r.get("companycode", ""))
            dev = _pk(r.get("developmentcode", ""))
            num = _i(r.get("housenumber", ""))
            cno = _pk(r.get("conumber", ""))
            adf = _pk(r.get("adddeleteflag", ""))   # always '' in source; stored as ''
            opc = _pk(r.get("optioncode", ""))
            # All PK fields must be non-null (housenumber is int, others are strings incl. '')
            if not cc or not dev or num is None or not cno or not opc:
                skipped += 1
                continue
            rows.append((
                cc, dev, num, cno, adf, opc,
                _s(r.get("optioncategory", "")),
                _s(r.get("location", "")),
                _n(r.get("quantity", "")),
                _s(r.get("description", "")),
                _n(r.get("salesprice", "")),
            ))
    if skipped:
        print(f"  Skipped {skipped} rows (missing required PK fields)")
    return rows


def main():
    parser = argparse.ArgumentParser(description="Load codetail CSV into devdb_ext.codetail")
    parser.add_argument("--csv", default=DEFAULT_CSV)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Loading: {args.csv}")
    rows = load_csv(args.csv)
    print(f"  Parsed {len(rows):,} rows")

    if args.dry_run:
        print("DRY RUN — no DB writes.")
        return

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()

    cur.execute("TRUNCATE devdb_ext.codetail")
    print("  Truncated devdb_ext.codetail")

    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO devdb_ext.codetail
               (companycode, developmentcode, housenumber, conumber, adddeleteflag, optioncode,
                optioncategory, location, quantity, description, salesprice)
               VALUES %s""",
            chunk,
        )
        print(f"  {min(i + CHUNK, len(rows)):,}/{len(rows):,} inserted...", end="\r")
    print()

    conn.commit()
    cur.close()
    conn.close()
    print(f"  Inserted {len(rows):,} rows into devdb_ext.codetail")
    print("Done.")


if __name__ == "__main__":
    main()
