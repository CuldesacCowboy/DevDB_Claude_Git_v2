"""
load_ext_housemaster.py
Load housemaster.csv into devdb_ext.housemaster (truncate + reload).

Source: ReferenceFiles/housemaster.csv  (exported from MARKS tzzM01_JTH_HOUSEMASTER1)
Target: devdb_ext.housemaster

Only the four columns the simulation engine needs are stored:
  development_code  (DEVELOPMENTCODE)
  house_number      (HOUSENUMBER, stripped of leading zeros, cast to int)
  company_code      (COMPANYCODE)
  model_code        (MODELCODE)

Usage:
  python load_ext_housemaster.py [--csv PATH] [--dry-run]

  --csv      Path to housemaster.csv (default: ReferenceFiles/housemaster.csv)
  --dry-run  Parse and report counts without writing to DB
"""

import argparse
import csv
import os
import sys

import psycopg2
import psycopg2.extras

DEFAULT_CSV = os.path.join(
    os.path.dirname(__file__), "..", "..", "ReferenceFiles", "housemaster.csv"
)
DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)


def load_csv(csv_path):
    """
    Parse housemaster CSV.
    Returns list of (development_code, house_number, company_code, model_code).
    Skips rows where HOUSENUMBER is not parseable as int.
    """
    rows = []
    skipped = 0

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dev = row.get("DEVELOPMENTCODE", "").strip()
            cc  = row.get("COMPANYCODE", "").strip() or None
            mc  = row.get("MODELCODE", "").strip() or None
            try:
                num = int(row.get("HOUSENUMBER", "").strip())
            except (ValueError, KeyError):
                skipped += 1
                continue
            if not dev:
                skipped += 1
                continue
            rows.append((dev, num, cc, mc))

    if skipped:
        print(f"  Skipped {skipped} rows (unparseable HOUSENUMBER or missing dev code)")
    return rows


def main():
    parser = argparse.ArgumentParser(description="Load housemaster CSV into devdb_ext.housemaster")
    parser.add_argument("--csv", default=DEFAULT_CSV, help="Path to housemaster.csv")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, do not write to DB")
    args = parser.parse_args()

    print(f"Loading: {args.csv}")
    rows = load_csv(args.csv)
    print(f"  Parsed {len(rows):,} rows")

    if args.dry_run:
        print("DRY RUN — no DB writes.")
        return

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()

    cur.execute("TRUNCATE devdb_ext.housemaster")
    print(f"  Truncated devdb_ext.housemaster")

    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO devdb_ext.housemaster
            (development_code, house_number, company_code, model_code, imported_at)
        VALUES %s
        """,
        [(dev, num, cc, mc) for dev, num, cc, mc in rows],
        template="(%s, %s, %s, %s, NOW())",
    )

    conn.commit()
    cur.close()
    conn.close()
    print(f"  Inserted {len(rows):,} rows into devdb_ext.housemaster")
    print("Done.")


if __name__ == "__main__":
    main()
