# test_s05_s08.py
# Validates S-05 through S-08 against live Databricks data.
# Run from devdb_python/ directory:  python -m tests.test_s05_s08
#
# Scenario 5 baseline:
#   S-05: PG 307 has no TDA -- snapshot passes through unchanged, 0 gaps.
#   S-05b: TDA fixture (lot_ids 9001-9030) -- Scenario 2 expectations.
#   S-06: No projection params -> needs_config=True. Weight math verified.
#   S-07: Correct pull order (U, H, D). Allocates what's available.
#   S-08: Temp lots generated with correct dates, lot_source, PG derivation.

import sys
import os
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.connection import PGConnection as DBConnection
from engine.s01_lot_loader import lot_loader
from engine.s02_date_actualizer import date_actualizer
from engine.s03_gap_fill_engine import gap_fill_engine, DEFAULT_LAG_CMP_FROM_STR, DEFAULT_LAG_CLS_FROM_CMP
from engine.s04_chronology_validator import chronology_validator
from engine.s05_takedown_engine import takedown_engine
from engine.s06_demand_generator import demand_generator, SEASONAL_WEIGHTS_BALANCED_2YR
from engine.s07_demand_allocator import demand_allocator
from engine.s08_temp_lot_generator import temp_lot_generator

TEST_PG_ID = 307
RUN_START = date(2026, 3, 1)


def _pass(label: str, condition: bool, detail: str = ""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def _pipeline_to_s04(conn, pg_id):
    """Run S-01 through S-04 and return the filled snapshot."""
    snapshot = lot_loader(conn, pg_id)
    actualized = date_actualizer(conn, snapshot)
    filled = gap_fill_engine(actualized)
    snapshot_out, _, _ = chronology_validator(filled)
    return snapshot_out


def test_s05_no_tda(conn, filled):
    print("\n=== S-05 takedown_engine (PG 307, no TDA) ===")
    updated, gaps = takedown_engine(conn, filled, TEST_PG_ID)
    results = [
        _pass("Row count preserved", len(updated) == len(filled),
              f"{len(updated)} rows"),
        _pass("0 residual gaps", len(gaps) == 0, f"{len(gaps)} gaps"),
        _pass("Columns intact", list(updated.columns) == list(filled.columns)),
    ]
    return updated, all(results)


def test_s05_tda_scenario2(conn):
    print("\n=== S-05 takedown_engine (TDA Scenario 2, lots 9001-9030) ===")
    tda_snapshot = conn.read_df("""
        SELECT *
        FROM main.devdb.sim_lots
        WHERE lot_id >= 9001 AND lot_id <= 9030 AND lot_source = 'real'
    """)

    if tda_snapshot.empty:
        print("  [SKIP] TDA fixture lots not present (9001-9030). "
              "Re-seed via seed migration before running Scenario 2.")
        return True  # not a failure -- fixtures just need re-seeding

    from engine.s03_gap_fill_engine import gap_fill_engine
    tda_snapshot = gap_fill_engine(tda_snapshot)

    print(f"  TDA fixture lots: {len(tda_snapshot)} (expect 30)")
    pre_td = tda_snapshot["date_td"].notna().sum()
    print(f"  Pre-run date_td count: {pre_td} (expect 12)")

    updated, gaps = takedown_engine(conn, tda_snapshot, 165)

    post_td     = updated["date_td"].notna().sum()
    post_hold   = updated["date_td_hold"].notna().sum()
    e_unchanged = ((updated["date_dev"].isna()) & (updated["date_td_hold"].isna())).sum()

    results = [
        _pass("date_td unchanged (12)", int(post_td) == 12, f"got {int(post_td)}"),
        _pass("date_td_hold set (8)", int(post_hold) == 8, f"got {int(post_hold)}"),
        _pass("E lots untouched (10)", int(e_unchanged) == 10, f"got {int(e_unchanged)}"),
        _pass("1 residual gap (CP3)", len(gaps) == 1, f"got {len(gaps)}"),
    ]
    if gaps:
        g = gaps[0]
        results.append(_pass("Gap = 10", g["gap"] == 10, f"gap={g['gap']}"))

    return all(results)


def test_s06(conn):
    print("\n=== S-06 demand_generator ===")

    # No params case: use a nonexistent PG
    series_empty, needs_config_true = demand_generator(conn, 999999, RUN_START)
    results = [
        _pass("No params -> empty series", len(series_empty) == 0,
              f"len={len(series_empty)}"),
        _pass("No params -> needs_config=True", needs_config_true is True),
    ]

    # With params case: PG 307 has annual_starts_target=22
    series, needs_config = demand_generator(conn, TEST_PG_ID, RUN_START)
    results += [
        _pass("Params found -> non-empty series", len(series) > 0,
              f"len={len(series)}"),
        _pass("Params found -> needs_config=False", needs_config is False),
        _pass("Series has 360 months", len(series) == 360,
              f"len={len(series)}"),
    ]

    # Weight math
    weights = SEASONAL_WEIGHTS_BALANCED_2YR
    weight_sum = sum(weights.values())
    results.append(_pass("Weights sum to 1.0", abs(weight_sum - 1.0) < 0.001,
                         f"sum={weight_sum:.4f}"))
    annual = 22
    total = sum(annual * weights[m] for m in range(1, 13))
    results.append(_pass("Annual total correct at 22/yr", abs(total - annual) < 0.01,
                         f"total={total:.2f}"))
    # First FULL calendar year (run starts mid-year, so use year+1)
    full_year = RUN_START.year + 1
    full_year_total = sum(v for y, m, v in series if y == full_year)
    results.append(_pass("Full calendar year sum ~= annual target",
                         abs(full_year_total - annual) < 1.0,
                         f"year={full_year} sum={full_year_total:.2f}"))

    return all(results)


def test_s07(filled):
    print("\n=== S-07 demand_allocator ===")

    import pandas as pd
    from dateutil.relativedelta import relativedelta

    # Synthetic demand: 1 slot/month for 6 months
    synthetic = [(
        (RUN_START + relativedelta(months=i)).year,
        (RUN_START + relativedelta(months=i)).month,
        1,
    ) for i in range(6)]

    allocated_df, unmet = demand_allocator(filled, synthetic)

    # Count allocatable lots: U + H + D
    u = (filled["date_td"].notna() & filled["date_str"].isna()).sum()
    h = (filled["date_td_hold"].notna() & filled["date_td"].isna() & filled["date_str"].isna()).sum()
    d = (
        filled["date_dev"].notna()
        & filled["date_td"].isna()
        & filled["date_td_hold"].isna()
        & filled["date_str"].isna()
    ).sum()
    allocatable = int(u + h + d)

    expected_alloc = min(allocatable, 6)
    expected_unmet = max(0, 6 - allocatable)

    results = [
        _pass("Allocated count correct", len(allocated_df) == expected_alloc,
              f"got {len(allocated_df)}, expect {expected_alloc}"),
        _pass("Unmet count correct", len(unmet) == expected_unmet,
              f"got {len(unmet)}, expect {expected_unmet}"),
        _pass("No duplicate allocations", allocated_df["lot_id"].nunique() == len(allocated_df)
              if not allocated_df.empty else True),
        _pass("No started lots allocated",
              not (filled.loc[filled["date_str"].notna(), "lot_id"]
                   .isin(allocated_df["lot_id"])).any()
              if not allocated_df.empty else True),
    ]
    return allocated_df, unmet, all(results)


def test_s08(conn, unmet):
    print("\n=== S-08 temp_lot_generator ===")

    from datetime import timedelta

    # Load phase capacity for TEST_PG_ID, including dev_id from sim_dev_phases
    phase_cap_df = conn.read_df(f"""
        SELECT sps.phase_id, sdp.dev_id, sps.lot_type_id, sps.lot_count,
               sdp.date_dev_projected,
               COALESCE(real_counts.real_count, 0) AS real_lot_count
        FROM main.devdb.sim_phase_product_splits sps
        JOIN main.devdb.sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        LEFT JOIN (
            SELECT phase_id, lot_type_id, COUNT(*) AS real_count
            FROM main.devdb.sim_lots
            WHERE projection_group_id = {TEST_PG_ID} AND lot_source = 'real'
            GROUP BY phase_id, lot_type_id
        ) real_counts ON sps.phase_id = real_counts.phase_id
                      AND sps.lot_type_id = real_counts.lot_type_id
        WHERE (sps.lot_count - COALESCE(real_counts.real_count, 0)) > 0
        ORDER BY sps.phase_id
    """)

    phase_capacity = [
        {
            "phase_id":        int(r["phase_id"]),
            "dev_id":          int(r["dev_id"]),
            "lot_type_id":     int(r["lot_type_id"]),
            "available_slots": int(r["lot_count"]) - int(r["real_lot_count"]),
            "date_dev":        r["date_dev_projected"],
        }
        for _, r in phase_cap_df.iterrows()
    ]

    # Build lot_type_pg_map: {(dev_id, phase_lot_type_id): projection_group_id}
    # Phase lot types (101=SF, 111=CD) differ from PG lot types (201=SF-PG, 202=CD-PG).
    # Bridge via ref_lot_types.proj_lot_type_group_id (same for matching SF/SF-PG pair).
    if phase_capacity:
        pairs = {(pc["dev_id"], pc["lot_type_id"]) for pc in phase_capacity}
        conditions = " OR ".join(
            f"(sdp.dev_id = {dev_id} AND sps.lot_type_id = {lt_id})"
            for dev_id, lt_id in pairs
        )
        pg_df = conn.read_df(f"""
            SELECT DISTINCT sdp.dev_id, sps.lot_type_id AS phase_lot_type_id,
                   dpg.projection_group_id
            FROM main.devdb.sim_dev_phases sdp
            JOIN main.devdb.sim_phase_product_splits sps ON sdp.phase_id = sps.phase_id
            JOIN main.devdb.ref_lot_types rlt_phase ON sps.lot_type_id = rlt_phase.lot_type_id
            JOIN main.devdb.dim_projection_groups dpg ON sdp.dev_id = dpg.dev_id
            JOIN main.devdb.ref_lot_types rlt_pg
              ON dpg.lot_type_id = rlt_pg.lot_type_id
              AND rlt_phase.proj_lot_type_group_id = rlt_pg.proj_lot_type_group_id
            WHERE {conditions}
        """)
        lot_type_pg_map = {
            (int(r["dev_id"]), int(r["phase_lot_type_id"])): int(r["projection_group_id"])
            for _, r in pg_df.iterrows()
        }
    else:
        lot_type_pg_map = {}

    if not unmet:
        print("  No unmet demand from S-07 -- using synthetic unmet for S-08 test")
        unmet = [(2027, 1, 2), (2027, 2, 1)]

    if not phase_capacity:
        print("  [SKIP] No phase capacity rows -- sim_phase_product_splits not populated for PG 307")
        return [], True

    sim_run_id = 20260323
    temp_lots = temp_lot_generator(unmet, phase_capacity, lot_type_pg_map, sim_run_id)

    total_unmet = sum(int(c) for _, _, c in unmet)
    total_capacity = sum(p["available_slots"] for p in phase_capacity)
    expected = min(total_unmet, total_capacity)

    results = [
        _pass("Count = min(unmet, capacity)", len(temp_lots) == expected,
              f"got {len(temp_lots)}, expect {expected}"),
        _pass("All lot_source = 'sim'", all(l["lot_source"] == "sim" for l in temp_lots)),
        _pass("All builder_id null", all(l["builder_id"] is None for l in temp_lots)),
        _pass("All lot_id null", all(l["lot_id"] is None for l in temp_lots)),
        _pass("Dates set on all lots",
              all(l["date_str"] is not None and l["date_cmp"] is not None
                  and l["date_cls"] is not None for l in temp_lots)),
        _pass("No null projection_group_id",
              all(l["projection_group_id"] is not None for l in temp_lots),
              f"{sum(1 for l in temp_lots if l['projection_group_id'] is None)} nulls"),
    ]

    if temp_lots:
        lot0 = temp_lots[0]
        exp_cmp = lot0["date_str"] + timedelta(days=270)
        exp_cls = exp_cmp + timedelta(days=45)
        results.append(_pass("Date math correct",
                             lot0["date_cmp"] == exp_cmp and lot0["date_cls"] == exp_cls,
                             f"str={lot0['date_str']} cmp={lot0['date_cmp']} cls={lot0['date_cls']}"))

        # PG derivation: first lot comes from first phase slot;
        # look up expected PG via (dev_id, lot_type_id) tuple from dim_projection_groups
        first_phase = phase_capacity[0]
        lot0_key = (first_phase["dev_id"], lot0["lot_type_id"])
        expected_pg = lot_type_pg_map.get(lot0_key)
        results.append(_pass(
            "PG derived from (dev_id, lot_type_id) tuple",
            lot0["projection_group_id"] == expected_pg,
            f"key={lot0_key} got {lot0['projection_group_id']}, expect {expected_pg}",
        ))

    return temp_lots, all(results)


def run_all():
    print(f"DevDB S-05 through S-08 -- PG {TEST_PG_ID}")
    print("=" * 60)

    with DBConnection() as conn:
        print("Running S-01 through S-04 to build snapshot...")
        filled = _pipeline_to_s04(conn, TEST_PG_ID)
        print(f"Snapshot ready: {len(filled)} lots")

        updated, ok_s05 = test_s05_no_tda(conn, filled)
        ok_s05b = test_s05_tda_scenario2(conn)
        ok_s06  = test_s06(conn)
        _, unmet, ok_s07 = test_s07(filled)
        _, ok_s08 = test_s08(conn, unmet)

    print("\n" + "=" * 60)
    all_pass = ok_s05 and ok_s05b and ok_s06 and ok_s07 and ok_s08
    print(f"S-05: {'PASS' if ok_s05 else 'FAIL'}  "
          f"S-05b: {'PASS' if ok_s05b else 'FAIL'}  "
          f"S-06: {'PASS' if ok_s06 else 'FAIL'}  "
          f"S-07: {'PASS' if ok_s07 else 'FAIL'}  "
          f"S-08: {'PASS' if ok_s08 else 'FAIL'}")
    print(f"Result: {'ALL PASS' if all_pass else 'FAILURES DETECTED'}")
    return all_pass


if __name__ == "__main__":
    run_all()
