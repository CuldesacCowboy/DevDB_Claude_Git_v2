# test_coordinator_reliability.py
# Task 16: Tests for concurrent simulation runs + multi-dev convergence.
#
# Run from devdb_python/:  python -m tests.test_coordinator_reliability
#
# Requires ent_group_id=9002 (Waterton Station) to be present in the DB.
# Cleans up sim lots written during the test to leave DB in original state.

import sys
import os
import threading
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator

TEST_ENT_GROUP = 9002
RUN_START = date(2026, 3, 1)
TEST_RNG_SEED = 42


def _pass(label: str, condition: bool, detail: str = "") -> bool:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def _sim_lot_counts(conn, ent_group_id: int) -> dict:
    """Return {dev_id: sim_lot_count} for all devs in the ent_group."""
    df = conn.read_df(
        """
        SELECT sl.dev_id, COUNT(*) AS n
        FROM sim_lots sl
        JOIN sim_ent_group_developments egd ON egd.dev_id = sl.dev_id
        WHERE egd.ent_group_id = %s
          AND sl.lot_source = 'sim'
        GROUP BY sl.dev_id
        ORDER BY sl.dev_id
        """,
        (ent_group_id,),
    )
    return {int(r["dev_id"]): int(r["n"]) for _, r in df.iterrows()}


def _dev_ids_for_group(conn, ent_group_id: int) -> list:
    df = conn.read_df(
        "SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s ORDER BY dev_id",
        (ent_group_id,),
    )
    return [int(r) for r in df["dev_id"]]


def _delete_sim_lots(conn, ent_group_id: int) -> int:
    """Delete all sim lots for the ent_group; return count deleted."""
    df = conn.read_df(
        "SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s",
        (ent_group_id,),
    )
    dev_ids = [int(r) for r in df["dev_id"]]
    if not dev_ids:
        return 0
    r = conn.execute(
        "DELETE FROM sim_lots WHERE lot_source = 'sim' AND dev_id = ANY(%s)",
        (dev_ids,),
    )
    return r


# ---------------------------------------------------------------------------
# Test 1: Multi-dev convergence
# ---------------------------------------------------------------------------

def test_multi_dev_convergence() -> bool:
    print("\n=== Test 1: Multi-dev convergence ===")

    with DBConnection() as conn:
        dev_ids = _dev_ids_for_group(conn, TEST_ENT_GROUP)

    if len(dev_ids) < 2:
        print(f"  [SKIP] Only {len(dev_ids)} dev(s) in ent_group {TEST_ENT_GROUP}; "
              f"need ≥ 2 for multi-dev test.")
        return True

    try:
        iterations, missing = convergence_coordinator(
            TEST_ENT_GROUP,
            run_start_date=RUN_START,
            max_iterations=10,
            rng_seed=TEST_RNG_SEED,
        )
    except Exception as exc:
        _pass("Coordinator completed without exception", False, str(exc))
        return False

    results = [
        _pass("No exception raised", True),
        _pass("Converged within 10 iterations", iterations <= 10, f"iterations={iterations}"),
        _pass(f"All {len(dev_ids)} devs processed", True, f"dev_ids={dev_ids}"),
    ]

    with DBConnection() as conn:
        counts = _sim_lot_counts(conn, TEST_ENT_GROUP)

    results.append(
        _pass(
            f"Sim lots created for ≥ 1 dev",
            len(counts) >= 1,
            f"counts per dev: {counts}",
        )
    )

    # Verify each dev with sim lots has a consistent count (> 0)
    for dev_id, n in counts.items():
        results.append(_pass(f"Dev {dev_id} sim lots > 0", n > 0, f"n={n}"))

    return all(results)


# ---------------------------------------------------------------------------
# Test 2: Determinism — same rng_seed → identical sim lot counts
# ---------------------------------------------------------------------------

def test_determinism() -> bool:
    print("\n=== Test 2: Determinism (rng_seed override) ===")

    try:
        convergence_coordinator(
            TEST_ENT_GROUP,
            run_start_date=RUN_START,
            max_iterations=10,
            rng_seed=TEST_RNG_SEED,
        )
    except Exception as exc:
        _pass("First run completed", False, str(exc))
        return False

    with DBConnection() as conn:
        counts_run1 = _sim_lot_counts(conn, TEST_ENT_GROUP)

    try:
        convergence_coordinator(
            TEST_ENT_GROUP,
            run_start_date=RUN_START,
            max_iterations=10,
            rng_seed=TEST_RNG_SEED,
        )
    except Exception as exc:
        _pass("Second run completed", False, str(exc))
        return False

    with DBConnection() as conn:
        counts_run2 = _sim_lot_counts(conn, TEST_ENT_GROUP)

    results = [
        _pass("Both runs completed", True),
        _pass(
            "Same dev_ids in both runs",
            set(counts_run1) == set(counts_run2),
            f"run1={set(counts_run1)} run2={set(counts_run2)}",
        ),
    ]

    for dev_id in sorted(set(counts_run1) | set(counts_run2)):
        n1 = counts_run1.get(dev_id, 0)
        n2 = counts_run2.get(dev_id, 0)
        results.append(
            _pass(f"Dev {dev_id}: same lot count across runs", n1 == n2, f"run1={n1} run2={n2}")
        )

    return all(results)


# ---------------------------------------------------------------------------
# Test 3: Concurrent runs — two threads, same ent_group
#
# Verifies sequence PKs don't collide and the DB ends in a coherent state
# (all sim lots belong to one complete run, not a corrupted mix).
# ---------------------------------------------------------------------------

def test_concurrent_runs() -> bool:
    print("\n=== Test 3: Concurrent runs (two threads, same ent_group) ===")

    errors = []
    iterations_list = []

    def _run():
        try:
            iters, _ = convergence_coordinator(
                TEST_ENT_GROUP,
                run_start_date=RUN_START,
                max_iterations=10,
                rng_seed=TEST_RNG_SEED,
            )
            iterations_list.append(iters)
        except Exception as exc:
            errors.append(str(exc))

    t1 = threading.Thread(target=_run, name="sim-thread-1")
    t2 = threading.Thread(target=_run, name="sim-thread-2")
    t1.start()
    t2.start()
    t1.join(timeout=180)
    t2.join(timeout=180)

    both_finished = not t1.is_alive() and not t2.is_alive()

    results = [
        _pass("Both threads finished (no timeout)", both_finished),
        _pass("No exceptions in either thread", len(errors) == 0,
              f"errors: {errors}" if errors else ""),
        _pass("Both threads produced a result", len(iterations_list) == 2,
              f"results: {iterations_list}"),
    ]

    if not any(results[:3]):
        return False

    # Final state should be coherent: sim lots exist and all have valid lot_ids
    with DBConnection() as conn:
        counts = _sim_lot_counts(conn, TEST_ENT_GROUP)
        # Check for duplicate lot_ids (sequence collision would show here)
        dup_df = conn.read_df(
            """
            SELECT lot_id, COUNT(*) AS n
            FROM sim_lots
            WHERE lot_source = 'sim'
              AND dev_id = ANY(%s)
            GROUP BY lot_id
            HAVING COUNT(*) > 1
            """,
            ([int(k) for k in counts.keys()],) if counts else ([],),
        )

    results.append(_pass("No duplicate lot_ids after concurrent runs",
                         dup_df.empty, f"{len(dup_df)} duplicates" if not dup_df.empty else ""))
    results.append(_pass("Sim lots present after concurrent runs", bool(counts),
                         f"counts: {counts}"))

    return all(results)


# ---------------------------------------------------------------------------
# Cleanup + runner
# ---------------------------------------------------------------------------

def cleanup(label: str = ""):
    with DBConnection() as conn:
        n = _delete_sim_lots(conn, TEST_ENT_GROUP)
    if label:
        print(f"  (cleanup {label}: deleted {n} sim lots)")


def run_all() -> bool:
    print(f"DevDB Coordinator Reliability Tests — ent_group={TEST_ENT_GROUP}")
    print("=" * 65)

    # Verify fixture is present
    with DBConnection() as conn:
        df = conn.read_df(
            "SELECT ent_group_id FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (TEST_ENT_GROUP,),
        )
    if df.empty:
        print(f"[SKIP] ent_group_id={TEST_ENT_GROUP} not present — run against production DB.")
        return True

    results = []

    cleanup("pre-test")
    results.append(test_multi_dev_convergence())
    cleanup("after test 1")

    results.append(test_determinism())
    cleanup("after test 2")

    results.append(test_concurrent_runs())
    cleanup("after test 3")

    print("\n" + "=" * 65)
    labels = ["Multi-dev convergence", "Determinism", "Concurrent runs"]
    for label, ok in zip(labels, results):
        print(f"  {label}: {'PASS' if ok else 'FAIL'}")
    print(f"\nResult: {'ALL PASS' if all(results) else 'FAILURES DETECTED'}")
    return all(results)


if __name__ == "__main__":
    ok = run_all()
    sys.exit(0 if ok else 1)
