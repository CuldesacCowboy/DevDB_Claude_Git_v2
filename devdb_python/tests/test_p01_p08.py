# test_p01_p08.py
# Validates P-01 through P-08 against live Databricks data.
# Uses synthetic Waterton Station fixtures (ent_group_id=9001).
# Run from devdb_python/:  python -m tests.test_p01_p08

import sys, os
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.connection import PGConnection as DBConnection
from engine.p01_actual_date_applicator import actual_date_applicator
from engine.p02_dependency_resolver import dependency_resolver
from engine.p03_constraint_urgency_ranker import constraint_urgency_ranker
from engine.p04_delivery_date_assigner import delivery_date_assigner
from engine.p05_eligibility_updater import eligibility_updater
from engine.p06_phase_date_propagator import phase_date_propagator
from engine.p07_lot_date_propagator import lot_date_propagator
from engine.p08_sync_flag_writer import sync_flag_writer

TEST_ENT_GROUP = 9001


def _pass(label, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def _check_fixtures(conn):
    """Verify synthetic Waterton Station fixtures are present."""
    eg = conn.read_df(f"""
        SELECT ent_group_id FROM main.devdb.sim_entitlement_groups
        WHERE ent_group_id = {TEST_ENT_GROUP}
    """)
    if eg.empty:
        print(f"  [SKIP] Fixtures not present (ent_group_id={TEST_ENT_GROUP}). "
              f"Seed synthetic Waterton Station fixtures before testing.")
        return False
    return True


def test_p01(conn):
    print(f"\n=== P-01 actual_date_applicator (ent_group={TEST_ENT_GROUP}) ===")

    # Count events with actual dates
    actual_count_df = conn.read_df(f"""
        SELECT COUNT(*) AS n FROM main.devdb.sim_delivery_events
        WHERE ent_group_id = {TEST_ENT_GROUP}
          AND date_dev_actual IS NOT NULL
    """)
    actual_count = int(actual_count_df.iloc[0]["n"])

    locked = actual_date_applicator(conn, TEST_ENT_GROUP)

    results = [
        _pass("Locked count matches actual event count",
              len(locked) == actual_count,
              f"locked={len(locked)} actual_events={actual_count}"),
    ]

    # If there were actual events, verify lots were updated (if any lots exist in phase)
    if actual_count > 0 and locked:
        event_id = locked[0]
        child_df = conn.read_df(f"""
            SELECT phase_id FROM main.devdb.sim_delivery_event_phases
            WHERE delivery_event_id = {event_id}
        """)
        if not child_df.empty:
            phase_id = int(child_df.iloc[0]["phase_id"])
            total_df = conn.read_df(f"""
                SELECT COUNT(*) AS n FROM main.devdb.sim_lots WHERE phase_id = {phase_id}
            """)
            total = int(total_df.iloc[0]["n"])
            if total == 0:
                print(f"  [INFO] No lots in phase {phase_id} -- date_dev propagation not verifiable.")
            else:
                set_df = conn.read_df(f"""
                    SELECT COUNT(*) AS n FROM main.devdb.sim_lots
                    WHERE phase_id = {phase_id} AND date_dev IS NOT NULL
                """)
                results.append(_pass("Lots under actual event have date_dev set",
                                     int(set_df.iloc[0]["n"]) > 0,
                                     f"{int(set_df.iloc[0]['n'])} of {total}"))

    return all(results)


def test_p02(conn):
    print(f"\n=== P-02 dependency_resolver ===")

    locked = actual_date_applicator(conn, TEST_ENT_GROUP)
    sorted_queue, eligible_pool = dependency_resolver(conn, TEST_ENT_GROUP, locked)

    locked_in_queue = [e for e in sorted_queue if e in set(locked)]
    results = [
        _pass("Returns tuple of two lists",
              isinstance(sorted_queue, list) and isinstance(eligible_pool, list)),
        _pass("Locked events not in sorted queue",
              len(locked_in_queue) == 0,
              f"found {len(locked_in_queue)} locked events in queue"),
        _pass("Eligible pool is subset of sorted queue",
              all(e in sorted_queue for e in eligible_pool)),
    ]

    # No cycles expected in well-formed fixtures
    return all(results)


def test_p03(conn):
    print(f"\n=== P-03 constraint_urgency_ranker ===")

    locked = actual_date_applicator(conn, TEST_ENT_GROUP)
    _, eligible_pool = dependency_resolver(conn, TEST_ENT_GROUP, locked)
    ranked = constraint_urgency_ranker(conn, eligible_pool)

    results = [
        _pass("Ranked length matches eligible pool",
              len(ranked) == len(eligible_pool),
              f"ranked={len(ranked)} pool={len(eligible_pool)}"),
        _pass("No duplicates in ranked list",
              len(ranked) == len(set(ranked))),
    ]

    return all(results)


def test_p04(conn):
    print(f"\n=== P-04 delivery_date_assigner ===")

    locked = actual_date_applicator(conn, TEST_ENT_GROUP)
    _, eligible_pool = dependency_resolver(conn, TEST_ENT_GROUP, locked)
    ranked = constraint_urgency_ranker(conn, eligible_pool)

    if not ranked:
        print("  [SKIP] No eligible events to assign.")
        return True

    event_id = ranked[0]
    projected = delivery_date_assigner(conn, event_id, TEST_ENT_GROUP)

    if projected is None:
        print("  [SKIP] All child phases had null demand_derived.")
        return True

    # Verify written to DB
    written_df = conn.read_df(f"""
        SELECT date_dev_projected FROM main.devdb.sim_delivery_events
        WHERE delivery_event_id = {event_id}
    """)
    written_val = written_df.iloc[0]["date_dev_projected"] if not written_df.empty else None

    import pandas as pd
    if written_val is not None:
        written_date = pd.Timestamp(written_val).date()
        val_matches = written_date == projected
    else:
        val_matches = False

    results = [
        _pass("date_dev_projected written to event", written_val is not None,
              f"got {written_val}"),
        _pass("Written value matches return", val_matches,
              f"written={written_val} returned={projected}"),
    ]

    # Never-later rule: run again with same data, should not change
    projected2 = delivery_date_assigner(conn, event_id, TEST_ENT_GROUP)
    results.append(_pass("Re-run never moves date later",
                         projected2 is None or projected2 <= projected,
                         f"first={projected} second={projected2}"))

    return all(results)


def test_p05(conn):
    print(f"\n=== P-05 eligibility_updater ===")

    locked = actual_date_applicator(conn, TEST_ENT_GROUP)
    sorted_queue, eligible_pool = dependency_resolver(conn, TEST_ENT_GROUP, locked)
    ranked = constraint_urgency_ranker(conn, eligible_pool)

    if not ranked:
        print("  [SKIP] No eligible events.")
        return True

    resolved_so_far = set(locked)
    resolved_event = ranked[0]
    updated_pool = eligibility_updater(conn, resolved_event, sorted_queue,
                                       list(eligible_pool), resolved_so_far)

    results = [
        _pass("Resolved event removed from pool",
              resolved_event not in updated_pool,
              f"event={resolved_event}"),
        _pass("resolved_so_far updated",
              resolved_event in resolved_so_far),
    ]

    return all(results)


def test_p06(conn):
    print(f"\n=== P-06 phase_date_propagator ===")

    locked = actual_date_applicator(conn, TEST_ENT_GROUP)
    _, eligible_pool = dependency_resolver(conn, TEST_ENT_GROUP, locked)
    ranked = constraint_urgency_ranker(conn, eligible_pool)

    if not ranked:
        print("  [SKIP] No eligible events.")
        return True

    event_id = ranked[0]
    projected = delivery_date_assigner(conn, event_id, TEST_ENT_GROUP)

    if projected is None:
        print("  [SKIP] All child phases had null demand_derived.")
        return True

    phase_date_propagator(conn, [(event_id, projected)])

    # Verify child phases were updated
    child_df = conn.read_df(f"""
        SELECT dp.phase_id, dp.date_dev_projected
        FROM main.devdb.sim_delivery_event_phases dep
        JOIN main.devdb.sim_dev_phases dp ON dep.phase_id = dp.phase_id
        WHERE dep.delivery_event_id = {event_id}
    """)

    all_set = (not child_df.empty and
               child_df["date_dev_projected"].notna().all())

    results = [
        _pass("Child phases have date_dev_projected set", all_set,
              f"{child_df['date_dev_projected'].notna().sum()} of {len(child_df)} phases"),
    ]

    return all(results)


def test_p07(conn):
    print(f"\n=== P-07 lot_date_propagator ===")

    locked = actual_date_applicator(conn, TEST_ENT_GROUP)
    _, eligible_pool = dependency_resolver(conn, TEST_ENT_GROUP, locked)
    ranked = constraint_urgency_ranker(conn, eligible_pool)

    if not ranked:
        print("  [SKIP] No eligible events.")
        return True

    event_id = ranked[0]
    projected = delivery_date_assigner(conn, event_id, TEST_ENT_GROUP)

    if projected is None:
        print("  [SKIP] All child phases had null demand_derived.")
        return True

    phase_date_propagator(conn, [(event_id, projected)])

    child_df = conn.read_df(f"""
        SELECT phase_id FROM main.devdb.sim_delivery_event_phases
        WHERE delivery_event_id = {event_id}
    """)
    updated_phases = [(int(r["phase_id"]), projected)
                      for _, r in child_df.iterrows()]

    lot_date_propagator(conn, updated_phases)

    # Verify sim lots in those phases have date_dev set
    if not child_df.empty:
        phase_ids_str = ", ".join(str(int(p)) for p in child_df["phase_id"])
        lots_df = conn.read_df(f"""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN date_dev IS NOT NULL THEN 1 ELSE 0 END) AS with_date
            FROM main.devdb.sim_lots
            WHERE phase_id IN ({phase_ids_str}) AND lot_source = 'sim'
        """)
        if not lots_df.empty and int(lots_df.iloc[0]["total"]) > 0:
            total = int(lots_df.iloc[0]["total"])
            with_date = int(lots_df.iloc[0]["with_date"])
            results = [_pass("Sim lots have date_dev set",
                             total == with_date,
                             f"{with_date} of {total}")]
            return all(results)

    print("  [SKIP] No sim lots in affected phases.")
    return True


def test_p08(conn):
    print(f"\n=== P-08 sync_flag_writer ===")

    # Snapshot pre-run phase dates
    pre_df = conn.read_df("""
        SELECT phase_id, date_dev_projected FROM main.devdb.sim_dev_phases
    """)
    pre_run = {int(r["phase_id"]): r["date_dev_projected"]
               for _, r in pre_df.iterrows()}

    # Run supply pipeline to produce post-run state
    locked = actual_date_applicator(conn, TEST_ENT_GROUP)
    _, eligible_pool = dependency_resolver(conn, TEST_ENT_GROUP, locked)
    ranked = constraint_urgency_ranker(conn, eligible_pool)

    if ranked:
        projected = delivery_date_assigner(conn, ranked[0], TEST_ENT_GROUP)
        if projected:
            phase_date_propagator(conn, [(ranked[0], projected)])
            child_df = conn.read_df(f"""
                SELECT phase_id FROM main.devdb.sim_delivery_event_phases
                WHERE delivery_event_id = {ranked[0]}
            """)
            lot_date_propagator(conn, [(int(r["phase_id"]), projected)
                                       for _, r in child_df.iterrows()])

    # Snapshot post-run
    post_df = conn.read_df("""
        SELECT phase_id, date_dev_projected FROM main.devdb.sim_dev_phases
    """)
    post_run = {int(r["phase_id"]): r["date_dev_projected"]
                for _, r in post_df.iterrows()}

    affected = sync_flag_writer(conn, pre_run, post_run)

    if affected:
        pg_ids_str = ", ".join(str(p) for p in affected)
        flags_df = conn.read_df(f"""
            SELECT projection_group_id, needs_rerun
            FROM main.devdb.dim_projection_groups
            WHERE projection_group_id IN ({pg_ids_str})
        """)
        all_set = flags_df["needs_rerun"].all() if not flags_df.empty else False
        results = [
            _pass("needs_rerun set on all affected PGs", all_set,
                  f"{len(affected)} PGs"),
        ]
    else:
        print("  [INFO] No phase dates changed -- needs_rerun test not applicable.")
        results = [_pass("sync_flag_writer ran without error", True)]

    return all(results)


def run_all():
    print(f"DevDB P-01 through P-08 -- ent_group={TEST_ENT_GROUP}")
    print("=" * 60)

    with DBConnection() as conn:
        if not _check_fixtures(conn):
            print("SKIP: Fixture data not present.")
            return False

        ok_p01 = test_p01(conn)
        ok_p02 = test_p02(conn)
        ok_p03 = test_p03(conn)
        ok_p04 = test_p04(conn)
        ok_p05 = test_p05(conn)
        ok_p06 = test_p06(conn)
        ok_p07 = test_p07(conn)
        ok_p08 = test_p08(conn)

    print("\n" + "=" * 60)
    all_pass = all([ok_p01, ok_p02, ok_p03, ok_p04,
                    ok_p05, ok_p06, ok_p07, ok_p08])
    print(f"P-01: {'PASS' if ok_p01 else 'FAIL'}  "
          f"P-02: {'PASS' if ok_p02 else 'FAIL'}  "
          f"P-03: {'PASS' if ok_p03 else 'FAIL'}  "
          f"P-04: {'PASS' if ok_p04 else 'FAIL'}  "
          f"P-05: {'PASS' if ok_p05 else 'FAIL'}  "
          f"P-06: {'PASS' if ok_p06 else 'FAIL'}  "
          f"P-07: {'PASS' if ok_p07 else 'FAIL'}  "
          f"P-08: {'PASS' if ok_p08 else 'FAIL'}")
    print(f"Result: {'ALL PASS' if all_pass else 'FAILURES DETECTED'}")
    return all_pass


if __name__ == "__main__":
    run_all()
