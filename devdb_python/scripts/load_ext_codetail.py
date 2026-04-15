"""
load_ext_codetail.py
Load codetail.csv into devdb_ext.codetail (truncate + reload).

Source: ReferenceFiles/csv exports/codetail.csv  (MARKS option/cost detail per lot)
Target: devdb_ext.codetail

Usage:
  python load_ext_codetail.py [--csv PATH] [--dry-run]
"""

import argparse
import csv
import os

import psycopg2
import psycopg2.extras

DEFAULT_CSV = os.path.join(
    os.path.dirname(__file__), "..", "..", "ReferenceFiles", "csv exports", "codetail.csv"
)
DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)


def _num(val):
    """Return Decimal-safe numeric or None."""
    v = (val or "").strip()
    try:
        return float(v) if v else None
    except ValueError:
        return None


def _int(val):
    v = (val or "").strip()
    try:
        return int(v)
    except ValueError:
        return None


def load_csv(csv_path):
    rows = []
    skipped = 0
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dev = row.get("developmentcode", "").strip()
            num = _int(row.get("housenumber", ""))
            if not dev or num is None:
                skipped += 1
                continue
            rows.append((
                row.get("companycode", "").strip() or None,
                dev,
                num,
                row.get("conumber", "").strip() or None,
                row.get("adddeleteflag", "").strip() or None,
                row.get("optioncode", "").strip() or None,
                row.get("optioncategory", "").strip() or None,
                row.get("location", "").strip() or None,
                _num(row.get("quantity")),
                row.get("description", "").strip() or None,
                _num(row.get("salesprice")),
            ))
    if skipped:
        print(f"  Skipped {skipped} rows (missing dev code or house number)")
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

    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO devdb_ext.codetail
            (company_code, development_code, house_number, co_number,
             add_delete_flag, option_code, option_category, location,
             quantity, description, sales_price, imported_at)
        VALUES %s
        """,
        rows,
        template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())",
        page_size=2000,
    )

    conn.commit()
    cur.close()
    conn.close()
    print(f"  Inserted {len(rows):,} rows into devdb_ext.codetail")
    print("Done.")


if __name__ == "__main__":
    main()
