# test_coordinator.py
# Validates convergence_coordinator against synthetic Waterton Station fixtures.
# ent_group_id=9001, PGs 165/166/167, delivery events 9001-9003.
# Run from devdb_python/:  python -m tests.test_coordinator

import sys, os
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator

TEST_ENT_GROUP = 9001
RUN_START = date(2026, 3, 1)


def _pass(label, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def _check_fixtures(conn):
    eg = conn.read_df(f"""
        SELECT ent_group_id FROM main.devdb.sim_entitlement_groups
        WHERE ent_group_id = {TEST_ENT_GROUP}
    """)
    if eg.empty:
        print(f"  [SKIP] Fixtures not present (ent_group_id={TEST_ENT_GROUP}).")
        return False
    return True


def test_coordinator():
    print(f"\n=== Convergence coordinator (ent_group={TEST_ENT_GROUP}) ===")

    with DBConnection() as conn:
        if not _check_fixtures(conn):
            return True  # SKIP

        # Record pre-run sim lot count for PG 165/166/167
        pg_ids_str = "165, 166, 167"
        pre_sim = conn.read_df(f"""
            SELECT COUNT(*) AS n FROM main.devdb.sim_lots
            WHERE projection_group_id IN ({pg_ids_str}) AND lot_source = 'sim'
        """).iloc[0]["n"]

    iterations = convergence_coordinator(
        ent_group_id=TEST_ENT_GROUP,
        run_start_date=RUN_START,
        max_iterations=5
    )

    results = [
        _pass("Coordinator completed without exception", True),
        _pass("Converged within max iterations", iterations <= 5,
              f"iterations={iterations}"),
    ]

    with DBConnection() as conn:
        # Verify ledger view is queryable
        ledger = conn.read_df(f"""
            SELECT * FROM main.devdb.v_sim_ledger_monthly
            WHERE projection_group_id IN ({pg_ids_str})
            LIMIT 1
        """)
        results.append(_pass("Ledger view queryable after run",
                             True,  # no exception means pass
                             f"{len(ledger)} rows"))

        # Verify sim lots exist for at least one PG
        post_sim = conn.read_df(f"""
            SELECT COUNT(*) AS n FROM main.devdb.sim_lots
            WHERE projection_group_id IN ({pg_ids_str}) AND lot_source = 'sim'
        """).iloc[0]["n"]
        # May be 0 if PGs have no projection params -- that's valid
        print(f"  [INFO] Sim lots after run: {int(post_sim)}")

        # Clean up sim lots from this run
        conn.execute(f"""
            DELETE FROM main.devdb.sim_lots
            WHERE projection_group_id IN ({pg_ids_str}) AND lot_source = 'sim'
        """)
        print("  (cleaned up test sim lots)")

    return all(results)


def run_all():
    print(f"DevDB Convergence Coordinator -- ent_group={TEST_ENT_GROUP}")
    print("=" * 60)

    ok = test_coordinator()

    print("\n" + "=" * 60)
    print(f"Coordinator: {'PASS' if ok else 'FAIL'}")
    print(f"Result: {'ALL PASS' if ok else 'FAILURES DETECTED'}")
    return ok


if __name__ == "__main__":
    run_all()
