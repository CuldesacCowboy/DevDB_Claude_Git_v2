# seed_developments.py
# Seeds the developments table from tbdDEVdev.csv.
# Safe to re-run: uses INSERT ... ON CONFLICT (marks_code) DO NOTHING.
#
# CSV location:
#   Default (hardcoded): C:\Users\HowieHehrer\OneDrive - JTB Homes, LLC\Desktop\DevDB\DevDBv01_Locked_20260302 - Exports\tbdDEVdev.csv
#   Override: pass path as first CLI argument
#
# Run:
#   cd devdb_python
#   python scripts/seed_developments.py
#   python scripts/seed_developments.py "path/to/tbdDEVdev.csv"

from __future__ import annotations

import csv
import os
import sys

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

_DEFAULT_CSV = (
    r"C:\Users\HowieHehrer\OneDrive - JTB Homes, LLC\Desktop\DevDB"
    r"\DevDBv01_Locked_20260302 - Exports\tbdDEVdev.csv"
)

_INSERT = """
INSERT INTO developments
    (dev_name, marks_code, in_marks, state_id, county_id, municipality_id, community_id)
VALUES
    (%(dev_name)s, %(marks_code)s, %(in_marks)s,
     %(state_id)s, %(county_id)s, %(municipality_id)s, NULL)
ON CONFLICT (marks_code) DO NOTHING
"""


def _int_or_none(val: str) -> int | None:
    v = val.strip() if val else ""
    return int(v) if v else None


def run(csv_path: str) -> None:
    rows: list[dict] = []
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            marks_code = (row.get("dDEVcode2") or "").strip() or None
            rows.append(
                {
                    "dev_name": row["dDEVname"].strip(),
                    "marks_code": marks_code,
                    "in_marks": True,
                    "state_id": _int_or_none(row.get("FKdDEVgSTAstate", "")),
                    "county_id": _int_or_none(row.get("FKdDEVgCNTcounty", "")),
                    "municipality_id": _int_or_none(row.get("FKdDEVgMUNmunicipality", "")),
                }
            )

    if not rows:
        print("No rows found in CSV — nothing to insert.")
        return

    conn = psycopg2.connect(
        host="localhost",
        database="devdb",
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
        port=int(os.getenv("PG_PORT", 5432)),
        options="-c search_path=devdb",
    )
    conn.autocommit = False
    inserted = 0
    try:
        with conn.cursor() as cur:
            for r in rows:
                cur.execute(_INSERT, r)
                inserted += cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    skipped = len(rows) - inserted
    print(f"Rows attempted : {len(rows)}")
    print(f"Rows inserted  : {inserted}")
    print(f"Rows skipped   : {skipped}")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else _DEFAULT_CSV
    if not os.path.exists(path):
        print(f"ERROR: CSV not found: {path}", file=sys.stderr)
        sys.exit(1)
    run(path)
