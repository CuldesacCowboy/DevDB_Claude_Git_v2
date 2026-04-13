"""
import_housemaster_builder.py
Apply lot-level builder assignments from MARKS housemaster export to sim_lots.builder_id.

Source: housemaster.csv (exported from Access tzzM01_JTH_HOUSEMASTER1 table)
Target: devdb.sim_lots.builder_id (the MARKS tier — never overrides builder_id_override)

Join key:
  housemaster.DEVELOPMENTCODE = dev_code part of sim_lots.lot_number  (e.g. "AE")
  housemaster.HOUSENUMBER (int) = numeric part of sim_lots.lot_number  (e.g. 36)

Priority rule (matches date handling):
  builder_id_override  -- user manual override, this script never touches it
  builder_id           -- MARKS data, this script writes here
  NULL                 -- engine assigns via splits at runtime

Usage:
  python import_housemaster_builder.py [--csv PATH] [--apply] [--dev AE]

  --csv    Path to housemaster.csv (default: ReferenceFiles/housemaster.csv)
  --apply  Write to DB (default is dry-run)
  --dev    Scope to one development code only
"""

import argparse
import csv
import os
import re
import sys

import psycopg2

DEFAULT_CSV = os.path.join(
    os.path.dirname(__file__), "..", "..", "ReferenceFiles", "housemaster.csv"
)
DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)


def load_company_map(conn):
    """Return {marks_company_code: builder_id} from dim_builders."""
    cur = conn.cursor()
    cur.execute(
        "SELECT marks_company_code, builder_id FROM devdb.dim_builders "
        "WHERE marks_company_code IS NOT NULL"
    )
    mapping = {row[0]: row[1] for row in cur.fetchall()}
    cur.close()
    return mapping


def load_housemaster(csv_path, company_map, scope_dev=None):
    """
    Parse housemaster CSV.
    Returns dict: {(dev_code, lot_num_int): builder_id}
    Skips rows with unknown COMPANYCODE or unparseable HOUSENUMBER.
    """
    result = {}
    skipped_unknown_cc = 0
    skipped_bad_num = 0

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dev = row["DEVELOPMENTCODE"].strip()
            if scope_dev and dev != scope_dev:
                continue
            cc = row["COMPANYCODE"].strip()
            if cc not in company_map:
                skipped_unknown_cc += 1
                continue
            try:
                num = int(row["HOUSENUMBER"].strip())
            except (ValueError, KeyError):
                skipped_bad_num += 1
                continue
            result[(dev, num)] = company_map[cc]

    if skipped_unknown_cc:
        print(f"  Skipped {skipped_unknown_cc} rows with unrecognized COMPANYCODE")
    if skipped_bad_num:
        print(f"  Skipped {skipped_bad_num} rows with unparseable HOUSENUMBER")

    return result


def load_sim_lots(conn, scope_dev=None):
    """
    Return real/pre lots from sim_lots.
    Returns list of (lot_id, lot_number, builder_id_override, builder_id, dev_code, lot_num_int)
    """
    cur = conn.cursor()
    query = """
        SELECT lot_id, lot_number, builder_id_override, builder_id
        FROM devdb.sim_lots
        WHERE lot_source IN ('real', 'pre')
    """
    cur.execute(query)
    rows = cur.fetchall()
    cur.close()

    result = []
    LOT_RE = re.compile(r"^([A-Z]+)(\d+)$")
    for lot_id, lot_number, override, builder_id in rows:
        m = LOT_RE.match(lot_number or "")
        if not m:
            continue  # non-standard lot_number format (PLT-xxx, numeric-only)
        dev_code = m.group(1)
        lot_num = int(m.group(2))
        if scope_dev and dev_code != scope_dev:
            continue
        result.append((lot_id, lot_number, override, builder_id, dev_code, lot_num))

    return result


def apply_updates(conn, updates, dry_run):
    """updates: list of (lot_id, new_builder_id)"""
    if not updates:
        return
    if dry_run:
        print(f"  DRY RUN: would update {len(updates)} lots")
        return

    cur = conn.cursor()
    for lot_id, builder_id in updates:
        cur.execute(
            "UPDATE devdb.sim_lots SET builder_id = %s, updated_at = NOW() WHERE lot_id = %s",
            (builder_id, lot_id),
        )
    conn.commit()
    cur.close()
    print(f"  Applied {len(updates)} builder_id updates")


def main():
    parser = argparse.ArgumentParser(description="Apply MARKS builder data to sim_lots")
    parser.add_argument("--csv", default=DEFAULT_CSV, help="Path to housemaster.csv")
    parser.add_argument("--apply", action="store_true", help="Write to DB (default: dry-run)")
    parser.add_argument("--dev", help="Scope to one development code (e.g. AE)")
    args = parser.parse_args()

    dry_run = not args.apply
    if dry_run:
        print("DRY RUN mode -- pass --apply to write to DB")
    print()

    conn = psycopg2.connect(**DB)

    # Load company code -> builder_id mapping
    company_map = load_company_map(conn)
    print(f"Company code map from dim_builders: {company_map}")

    # Load housemaster
    print(f"\nLoading housemaster from: {args.csv}")
    hm = load_housemaster(args.csv, company_map, scope_dev=args.dev)
    print(f"  Loaded {len(hm)} lot-builder assignments from housemaster")

    # Load sim_lots
    lots = load_sim_lots(conn, scope_dev=args.dev)
    print(f"  Loaded {len(lots)} real/pre lots from sim_lots")

    # Reconcile
    updates = []
    stats = {
        "already_correct": 0,
        "new_assignment": 0,
        "overwrite": 0,
        "not_in_hm": 0,
        "skipped_no_standard_key": 0,
    }

    for lot_id, lot_number, override, current_bid, dev_code, lot_num in lots:
        hm_bid = hm.get((dev_code, lot_num))

        if hm_bid is None:
            stats["not_in_hm"] += 1
            continue

        if current_bid == hm_bid:
            stats["already_correct"] += 1
            continue

        if current_bid is None:
            stats["new_assignment"] += 1
        else:
            stats["overwrite"] += 1
            # MARKS wins — housemaster is authoritative

        updates.append((lot_id, hm_bid))

    print(f"\nReconciliation results:")
    print(f"  Already correct (no change needed): {stats['already_correct']}")
    print(f"  New assignment (was NULL):           {stats['new_assignment']}")
    print(f"  Overwrite (MARKS differs from DB):   {stats['overwrite']}")
    print(f"  Not in housemaster (stays NULL):     {stats['not_in_hm']}")
    print(f"  Total updates to apply:              {len(updates)}")

    if stats["overwrite"] > 0:
        print(f"\n  NOTE: {stats['overwrite']} lots have builder_id that differs from housemaster.")
        print(f"        MARKS data wins -- these will be overwritten.")

    print()
    apply_updates(conn, updates, dry_run)

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
