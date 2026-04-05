"""
load_marks_lot_registry.py
Load deduplicated MARKS lots from OPTIONLOTMASTER CSV into marks_lot_registry.

- Deduplicates on (DEVELOPMENTCODE, LOTNUMBER) — keeps first record per pair.
- LOTNUMBER stored as integer (strips leading zeros).
- lot_number stored as DEVELOPMENTCODE || LOTNUMBER (8-digit zero-padded) to match sim_lots.

Run from repo root:
    python devdb_python/migrations/load_marks_lot_registry.py [path/to/tzzM08_JTH_OPTIONLOTMASTER.csv]

Defaults to: ReferenceFiles/tzzM08_JTH_OPTIONLOTMASTER.csv
"""

import csv
import os
import sys
import psycopg2

CSV_DEFAULT = os.path.join(
    os.path.dirname(__file__), '..', '..', 'ReferenceFiles', 'tzzM08_JTH_OPTIONLOTMASTER.csv'
)


def load(csv_path: str):
    conn = psycopg2.connect(dbname='devdb', user='postgres', host='localhost')
    cur = conn.cursor()

    # Read CSV, deduplicate on (DEVELOPMENTCODE, LOTNUMBER)
    seen = set()
    rows = []
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            dev  = r['DEVELOPMENTCODE'].strip()
            lot  = r['LOTNUMBER'].strip()
            key  = (dev, lot)
            if key in seen:
                continue
            seen.add(key)
            housenumber = int(lot)
            lot_number  = f"{dev}{str(housenumber).zfill(8)}"
            address1    = r.get('ADDRESS1', '').strip() or None
            rows.append((dev, housenumber, lot_number, address1))

    # Upsert — safe to re-run
    cur.execute("TRUNCATE devdb.marks_lot_registry")
    cur.executemany(
        """
        INSERT INTO devdb.marks_lot_registry (developmentcode, housenumber, lot_number, address1)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (developmentcode, housenumber) DO UPDATE
            SET lot_number = EXCLUDED.lot_number,
                address1   = EXCLUDED.address1
        """,
        rows,
    )
    conn.commit()
    print(f"Loaded {len(rows)} distinct MARKS lots into marks_lot_registry.")
    cur.close()
    conn.close()


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else CSV_DEFAULT
    load(os.path.abspath(path))
