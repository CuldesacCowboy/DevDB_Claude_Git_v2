"""
backfill_marks_dates.py — Apply MARKsystems dates to all real lots that have
a marks_lot_registry entry but have never had S-0200 run (all key dates null).

Uses the production date_actualizer (S-0200) directly, so exactly the same
priority logic (D-029) and write-back path apply.

Usage:
    python devdb_python/scripts/backfill_marks_dates.py [--apply]

--apply   Write dates to sim_lots (default: dry run, shows counts only).
"""

import argparse
import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import pandas as pd

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true',
                        help='Write resolved dates to sim_lots (default: dry run)')
    args = parser.parse_args()

    from devdb_python.engine.connection import PGConnection
    conn = PGConnection()

    # Load all real lots that have null key dates and at least one registry entry.
    # Include all columns date_actualizer needs.
    logger.info("Loading unprocessed lots from sim_lots ...")
    lot_snapshot = conn.read_df("""
        SELECT sl.lot_id, sl.lot_source, sl.lot_number,
               sl.date_ent, sl.date_dev,
               sl.date_td, sl.date_td_hold,
               sl.date_str, sl.date_str_source,
               sl.date_frm,
               sl.date_cmp, sl.date_cmp_source,
               sl.date_cls, sl.date_cls_source,
               sl.date_str_is_locked, sl.date_cmp_is_locked, sl.date_cls_is_locked
        FROM sim_lots sl
        WHERE sl.lot_source = 'real'
          AND sl.date_str IS NULL
          AND sl.date_td  IS NULL
          AND sl.date_cmp IS NULL
          AND sl.date_cls IS NULL
          AND EXISTS (
              SELECT 1 FROM marks_lot_registry mlr
              WHERE mlr.lot_number = sl.lot_number
          )
    """)

    logger.info(f"Loaded {len(lot_snapshot)} lots eligible for backfill.")

    if lot_snapshot.empty:
        logger.info("Nothing to do.")
        return

    if not args.apply:
        # Dry run: show how many lots per dev_code would be processed
        mlr = conn.read_df(
            "SELECT DISTINCT lot_number, developmentcode FROM marks_lot_registry "
            "WHERE lot_number = ANY(%s)",
            (lot_snapshot['lot_number'].dropna().unique().tolist(),),
        )
        preview = lot_snapshot.merge(mlr, on='lot_number', how='left')
        counts = (preview.groupby('developmentcode', dropna=False)
                  .size().reset_index(name='lots')
                  .sort_values('lots', ascending=False))
        print("\n--- DRY RUN: lots that would be processed by dev code ---")
        print(counts.to_string(index=False))
        print(f"\nTotal: {len(lot_snapshot)} lots across {len(counts)} dev codes.")
        print("Re-run with --apply to write dates.")
        return

    # Apply: run date_actualizer (S-0200) on the snapshot.
    # _write_back_dates inside date_actualizer commits after each column batch.
    from devdb_python.engine.s0200_date_actualizer import date_actualizer

    logger.info("Running date_actualizer ...")
    result = date_actualizer(conn, lot_snapshot)

    # Count how many lots received at least one date
    date_cols = ['date_td', 'date_td_hold', 'date_str', 'date_cmp', 'date_cls']
    filled = result[result[date_cols].notna().any(axis=1)]
    logger.info(f"Resolved dates for {len(filled)} of {len(lot_snapshot)} lots.")

    logger.info("Done. (execute_values commits each column batch automatically.)")


if __name__ == '__main__':
    main()
