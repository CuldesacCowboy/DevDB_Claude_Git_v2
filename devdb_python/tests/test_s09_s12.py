# test_s09_s12.py
# Validates S-09 through S-12 against live Databricks data.
# Run from devdb_python/:  python -m tests.test_s09_s12

import sys, os, copy
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.connection import PGConnection as DBConnection
from engine.s09_builder_assignment import builder_assignment
from engine.s10_demand_derived_date_writer import demand_derived_date_writer
from engine.s11_persistence_writer import persistence_writer
from engine.s12_ledger_aggregator import ledger_aggregator

TEST_PG_ID = 307
TEST_SIM_RUN = 20260323


def _pass(label, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def _make_temp_lots(n, phase_id=1, lot_type_id=1, pg_id=TEST_PG_ID):
    """Minimal synthetic temp lots for testing."""
    return [
        {
            "lot_id": None, "projection_group_id": pg_id,
            "phase_id": phase_id, "builder_id": None,
            "lot_source": "sim", "lot_number": None,
            "sim_run_id": TEST_SIM_RUN, "lot_type_id": lot_type_id,
            "building_group_id": None, "date_ent": None,
            "date_dev": None, "date_td": None, "date_td_hold": None,
            "date_str": date(2027, i + 1, 1), "date_str_source": "engine_filled",
            "date_frm": None,
            "date_cmp": date(2027, i + 1, 1) + timedelta(days=270),
            "date_cmp_source": "engine_filled",
            "date_cls": date(2027, i + 1, 1) + timedelta(days=270 + 45),
            "date_cls_source": "engine_filled",
            "created_at": None, "updated_at": None,
        }
        for i in range(n)
    ]


def test_s09():
    print("\n=== S-09 builder_assignment ===")

    # Test 1: 60/40 split, 5 lots -> 3 builder 101, 2 builder 102
    lots_5 = _make_temp_lots(5)
    splits_60_40 = {1: [{"builder_id": 101, "share": 0.6},
                        {"builder_id": 102, "share": 0.4}]}
    result = builder_assignment(copy.deepcopy(lots_5), splits_60_40)
    ids = [l["builder_id"] for l in result]
    results = [
        _pass("60/40 -- 3 builder 101", ids.count(101) == 3, f"got {ids.count(101)}"),
        _pass("60/40 -- 2 builder 102", ids.count(102) == 2, f"got {ids.count(102)}"),
        _pass("No null builder_ids", None not in ids),
    ]

    # Test 2: No splits -> builder_id stays null, no crash
    no_splits = builder_assignment(copy.deepcopy(lots_5), {})
    results.append(_pass("No splits -> null builder_ids",
                         all(l["builder_id"] is None for l in no_splits)))

    # Test 3: Splits don't sum to 1.0 -> normalize
    unbalanced = {1: [{"builder_id": 101, "share": 0.7},
                      {"builder_id": 102, "share": 0.7}]}  # sum=1.4
    norm_result = builder_assignment(copy.deepcopy(lots_5), unbalanced)
    norm_ids = [l["builder_id"] for l in norm_result]
    results.append(_pass("Normalized unbalanced splits -- all assigned",
                         None not in norm_ids, f"ids={norm_ids}"))

    # Test 4: Decimal share values (D-098)
    from decimal import Decimal
    decimal_splits = {1: [{"builder_id": 201, "share": Decimal("0.5")},
                          {"builder_id": 202, "share": Decimal("0.5")}]}
    dec_result = builder_assignment(copy.deepcopy(_make_temp_lots(4)), decimal_splits)
    dec_ids = [l["builder_id"] for l in dec_result]
    results.append(_pass("Decimal share values cast to float",
                         None not in dec_ids and len(dec_ids) == 4))

    return all(results)


def test_s10(conn):
    print("\n=== S-10 demand_derived_date_writer ===")

    # Find a real phase_id to write to (use first phase in PG 307)
    phases = conn.read_df(f"""
        SELECT DISTINCT phase_id
        FROM main.devdb.sim_lots
        WHERE projection_group_id = {TEST_PG_ID}
        LIMIT 1
    """)
    if phases.empty:
        print("  [SKIP] No phases found for PG 307")
        return True

    test_phase_id = int(phases.iloc[0]["phase_id"])

    # Read pre-test value
    pre = conn.read_df(f"""
        SELECT date_dev_demand_derived
        FROM main.devdb.sim_dev_phases
        WHERE phase_id = {test_phase_id}
    """)
    pre_val = pre.iloc[0]["date_dev_demand_derived"] if not pre.empty else None

    # Write a test date
    test_date = date(2027, 6, 1)
    test_lots = [
        {"phase_id": test_phase_id, "date_str": test_date},
        {"phase_id": test_phase_id, "date_str": date(2027, 7, 1)},
        {"phase_id": test_phase_id, "date_str": date(2027, 5, 1)},  # MIN -- should win
    ]
    demand_derived_date_writer(conn, test_lots)

    post = conn.read_df(f"""
        SELECT date_dev_demand_derived
        FROM main.devdb.sim_dev_phases
        WHERE phase_id = {test_phase_id}
    """)
    post_val = post.iloc[0]["date_dev_demand_derived"] if not post.empty else None

    import pandas as pd
    if post_val is not None:
        post_ts = pd.Timestamp(post_val)
        expected = pd.Timestamp(date(2027, 5, 1))
        date_correct = post_ts == expected
    else:
        date_correct = False

    results = [
        _pass("MIN date written (2027-05-01)", date_correct,
              f"wrote {post_val}"),
    ]

    # Empty lots -> no write, value unchanged
    demand_derived_date_writer(conn, [])
    post2 = conn.read_df(f"""
        SELECT date_dev_demand_derived
        FROM main.devdb.sim_dev_phases
        WHERE phase_id = {test_phase_id}
    """)
    post2_val = post2.iloc[0]["date_dev_demand_derived"] if not post2.empty else None
    results.append(_pass("Empty lots -> value unchanged",
                         str(post2_val) == str(post_val)))

    # Null date_str -> must not write null
    demand_derived_date_writer(conn, [{"phase_id": test_phase_id, "date_str": None}])
    post3 = conn.read_df(f"""
        SELECT date_dev_demand_derived
        FROM main.devdb.sim_dev_phases
        WHERE phase_id = {test_phase_id}
    """)
    post3_val = post3.iloc[0]["date_dev_demand_derived"] if not post3.empty else None
    results.append(_pass("Null date_str -> valid signal preserved",
                         str(post3_val) == str(post_val)))

    return all(results)


def test_s11(conn):
    print("\n=== S-11 persistence_writer ===")

    # Read real lot count before test
    real_before = conn.read_df(f"""
        SELECT COUNT(*) AS n FROM main.devdb.sim_lots
        WHERE projection_group_id = {TEST_PG_ID} AND lot_source = 'real'
    """).iloc[0]["n"]

    # Write 3 temp lots
    lots_3 = _make_temp_lots(3)
    persistence_writer(conn, lots_3, TEST_PG_ID, TEST_SIM_RUN)

    sim_after = conn.read_df(f"""
        SELECT COUNT(*) AS n FROM main.devdb.sim_lots
        WHERE projection_group_id = {TEST_PG_ID} AND lot_source = 'sim'
    """).iloc[0]["n"]
    real_after = conn.read_df(f"""
        SELECT COUNT(*) AS n FROM main.devdb.sim_lots
        WHERE projection_group_id = {TEST_PG_ID} AND lot_source = 'real'
    """).iloc[0]["n"]

    results = [
        _pass("3 sim lots written", int(sim_after) == 3, f"got {int(sim_after)}"),
        _pass("Real lots unchanged", int(real_after) == int(real_before),
              f"before={int(real_before)} after={int(real_after)}"),
    ]

    # Re-run with 2 lots -> previous 3 gone
    lots_2 = _make_temp_lots(2)
    persistence_writer(conn, lots_2, TEST_PG_ID, TEST_SIM_RUN + 1)

    sim_after2 = conn.read_df(f"""
        SELECT COUNT(*) AS n FROM main.devdb.sim_lots
        WHERE projection_group_id = {TEST_PG_ID} AND lot_source = 'sim'
    """).iloc[0]["n"]
    old_run = conn.read_df(f"""
        SELECT COUNT(*) AS n FROM main.devdb.sim_lots
        WHERE projection_group_id = {TEST_PG_ID} AND lot_source = 'sim'
          AND sim_run_id = {TEST_SIM_RUN}
    """).iloc[0]["n"]

    results += [
        _pass("Second write -> 2 sim lots", int(sim_after2) == 2,
              f"got {int(sim_after2)}"),
        _pass("Previous run lots gone", int(old_run) == 0,
              f"got {int(old_run)}"),
    ]

    # Clean up: delete test sim lots
    conn.execute(f"""
        DELETE FROM main.devdb.sim_lots
        WHERE projection_group_id = {TEST_PG_ID} AND lot_source = 'sim'
    """)
    print("  (cleaned up test sim lots)")

    return all(results)


def test_s12(conn):
    print("\n=== S-12 ledger_aggregator ===")

    ledger_aggregator(conn)

    # Verify views exist
    views = conn.read_df("""
        SHOW VIEWS IN main.devdb
    """)
    view_names = set(views.iloc[:, 1].tolist()) if not views.empty else set()
    # column name may be 'viewName' or 'tableName' depending on connector version
    for col in views.columns:
        vals = set(views[col].tolist())
        if "v_sim_ledger_monthly" in vals:
            view_names = vals
            break

    results = [
        _pass("month_spine view exists", "month_spine" in view_names),
        _pass("v_sim_ledger_monthly view exists", "v_sim_ledger_monthly" in view_names),
    ]

    # Query view -- should return rows with expected columns
    ledger = conn.read_df(f"""
        SELECT * FROM main.devdb.v_sim_ledger_monthly
        WHERE projection_group_id = {TEST_PG_ID}
        LIMIT 5
    """)
    expected_cols = {"projection_group_id", "builder_id", "calendar_month",
                     "ENT_plan", "STR_plan", "P_end", "UC_end", "C_end"}
    missing = expected_cols - set(ledger.columns)
    results += [
        _pass("View returns rows", len(ledger) > 0, f"{len(ledger)} rows"),
        _pass("All expected columns present", len(missing) == 0,
              f"missing={missing}"),
    ]

    return all(results)


def run_all():
    print(f"DevDB S-09 through S-12 -- PG {TEST_PG_ID}")
    print("=" * 60)

    ok_s09 = test_s09()

    with DBConnection() as conn:
        ok_s10 = test_s10(conn)
        ok_s11 = test_s11(conn)
        ok_s12 = test_s12(conn)

    print("\n" + "=" * 60)
    all_pass = ok_s09 and ok_s10 and ok_s11 and ok_s12
    print(f"S-09: {'PASS' if ok_s09 else 'FAIL'}  "
          f"S-10: {'PASS' if ok_s10 else 'FAIL'}  "
          f"S-11: {'PASS' if ok_s11 else 'FAIL'}  "
          f"S-12: {'PASS' if ok_s12 else 'FAIL'}")
    print(f"Result: {'ALL PASS' if all_pass else 'FAILURES DETECTED'}")
    return all_pass


if __name__ == "__main__":
    run_all()
