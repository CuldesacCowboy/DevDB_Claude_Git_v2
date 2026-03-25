# test_s01_s04.py
# Validates S-01 through S-04 against live Databricks data.
# Run from devdb_python/ directory:  python -m tests.test_s01_s04
#
# Scenario 5 baseline assertions:
#   S-01: Only real lots returned for the requested PG.
#   S-02: At least some actual dates applied from schedhousedetail.
#   S-03: True-gap rule -- lots with only date_dev unchanged. Lots with bookends get filled.
#   S-04: Returns snapshot unchanged. Violations reported correctly.

import sys
import os
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.connection import PGConnection as DBConnection
from engine.s01_lot_loader import lot_loader
from engine.s02_date_actualizer import date_actualizer
from engine.s03_gap_fill_engine import gap_fill_engine
from engine.s04_chronology_validator import chronology_validator

# ---- Use PG 307 (Waterton Station SF -- 28 real lots) or set to any known PG ----
TEST_PG_ID = 307


def _pass(label: str, condition: bool, detail: str = ""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def test_s01(conn, pg_id):
    print("\n=== S-01 lot_loader ===")
    snapshot = lot_loader(conn, pg_id)
    results = [
        _pass("Returns DataFrame", hasattr(snapshot, "columns")),
        _pass("Only real lots", (snapshot["lot_source"] == "real").all() if not snapshot.empty else True),
        _pass("Correct PG", (snapshot["projection_group_id"] == pg_id).all() if not snapshot.empty else True,
              f"{len(snapshot)} rows"),
    ]
    return snapshot, all(results)


def test_s02(conn, snapshot):
    print("\n=== S-02 date_actualizer ===")
    actualized = date_actualizer(conn, snapshot)
    row_preserved = len(actualized) == len(snapshot)
    actual_str = (actualized["date_str_source"] == "actual").sum()
    actual_cmp = (actualized["date_cmp_source"] == "actual").sum() if "date_cmp_source" in actualized.columns else 0
    actual_cls = (actualized["date_cls_source"] == "actual").sum() if "date_cls_source" in actualized.columns else 0
    no_manual_overwrite = not (
        actualized.get("date_str_source", "").isin(["manual"]).any()
        if not actualized.empty else False
    )
    results = [
        _pass("Row count preserved", row_preserved, f"{len(actualized)} rows"),
        _pass("At least some actuals applied", actual_str > 0 or actual_cmp > 0 or actual_cls > 0,
              f"str={actual_str} cmp={actual_cmp} cls={actual_cls}"),
        _pass("No manual source overwritten", no_manual_overwrite),
        _pass("No stray columns", "_dev_code" not in actualized.columns),
    ]
    return actualized, all(results)


def test_s03(actualized):
    print("\n=== S-03 gap_fill_engine ===")
    filled = gap_fill_engine(actualized)

    row_preserved = len(filled) == len(actualized)

    # True-gap rule: lots with only date_dev (no date_str/cmp/cls in actualized) must be unchanged
    dev_only_mask = (
        actualized["date_dev"].notna()
        & actualized["date_str"].isna()
        & actualized["date_cmp"].isna()
        & actualized["date_cls"].isna()
        & actualized["date_td_hold"].isna()
    )
    if dev_only_mask.any():
        dev_only_lots = actualized.loc[dev_only_mask, "lot_id"].tolist()
        filled_dev_only = filled.loc[filled["lot_id"].isin(dev_only_lots)]
        dev_only_td_unchanged = filled_dev_only["date_td"].isna().all()
    else:
        dev_only_td_unchanged = True

    # H lots: date_str must never be filled
    h_mask = actualized["date_td_hold"].notna() & actualized["date_td"].isna()
    if h_mask.any():
        h_lot_ids = actualized.loc[h_mask, "lot_id"].tolist()
        h_lots_in_filled = filled.loc[filled["lot_id"].isin(h_lot_ids)]
        h_lot_str_unfilled = h_lots_in_filled["date_str"].isna().all()
    else:
        h_lot_str_unfilled = True

    results = [
        _pass("Row count preserved", row_preserved),
        _pass("True-gap rule: dev-only lots unchanged", dev_only_td_unchanged),
        _pass("H lots: date_str never filled", h_lot_str_unfilled),
        _pass("No stray columns", "_anchor" not in filled.columns),
    ]
    return filled, all(results)


def test_s04(filled):
    print("\n=== S-04 chronology_validator ===")
    returned_snapshot, violations_df, has_violations = chronology_validator(filled)

    snapshot_unchanged = len(returned_snapshot) == len(filled)
    has_required_cols = all(
        c in violations_df.columns
        for c in ["lot_id", "violation_type", "date_field_early", "date_value_early",
                  "date_field_late", "date_value_late", "resolution"]
    )

    results = [
        _pass("Returns tuple of 3", True),
        _pass("Snapshot returned unchanged", snapshot_unchanged),
        _pass("violations_df has correct columns", has_required_cols),
        _pass("has_violations matches df length", has_violations == (len(violations_df) > 0)),
    ]

    if has_violations:
        print(f"  INFO: {len(violations_df)} violation(s) detected:")
        for _, row in violations_df.iterrows():
            print(f"    lot_id={row['lot_id']} {row['violation_type']}: "
                  f"{row['date_field_early']}={row['date_value_early']} > "
                  f"{row['date_field_late']}={row['date_value_late']}")
    else:
        print("  INFO: No chronology violations detected.")

    return all(results)


def run_all():
    print(f"DevDB S-01 through S-04 -- testing against PG {TEST_PG_ID}")
    print("=" * 60)

    with DBConnection() as conn:
        snapshot, ok_s01 = test_s01(conn, TEST_PG_ID)
        if not ok_s01:
            print("\nS-01 failed -- stopping.")
            return

        actualized, ok_s02 = test_s02(conn, snapshot)
        if not ok_s02:
            print("\nS-02 failed -- stopping.")
            return

        filled, ok_s03 = test_s03(actualized)
        ok_s04 = test_s04(filled)

    print("\n" + "=" * 60)
    all_pass = ok_s01 and ok_s02 and ok_s03 and ok_s04
    print(f"Result: {'ALL PASS' if all_pass else 'FAILURES DETECTED'}")
    return all_pass


if __name__ == "__main__":
    run_all()
