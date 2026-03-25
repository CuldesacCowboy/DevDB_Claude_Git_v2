# test_kernel_scenarios.py
# Scenario unit tests against the kernel boundary.
# All tests construct FrozenInput directly from fixture data.
# No DB connection required.
#
# Run with pytest from devdb_python/:
#   python -m pytest tests/test_kernel_scenarios.py -v
# Or standalone:
#   python -m tests.test_kernel_scenarios

import sys
import os
from datetime import date, timedelta

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kernel.frozen_input import FrozenInput
from kernel.planning_kernel import plan
from engine.s0810_building_group_enforcer import building_group_enforcer
from engine.s0800_temp_lot_generator import (
    _DEFAULT_LAG_CMP_FROM_STR,
    _DEFAULT_LAG_CLS_FROM_CMP,
)


# ─────────────────────────────────────────────────────────────
# Fixture helpers
# ─────────────────────────────────────────────────────────────

def _make_frozen_input(
    lot_snapshot,
    demand_series,
    phase_capacity,
    lot_type_pg_map=None,
    building_group_memberships=None,
    tda_hold_lot_ids=None,
    sim_run_id=1,
    projection_group_id=998,   # != 317 to avoid S-08 debug prints
):
    return FrozenInput(
        lot_snapshot=lot_snapshot,
        demand_series=demand_series,
        phase_capacity=phase_capacity,
        lot_type_pg_map=lot_type_pg_map if lot_type_pg_map is not None else {(1, 101): 998},
        building_group_memberships=building_group_memberships if building_group_memberships is not None else {},
        tda_hold_lot_ids=tda_hold_lot_ids if tda_hold_lot_ids is not None else set(),
        sim_run_id=sim_run_id,
        projection_group_id=projection_group_id,
    )


def _uc_lot(lot_id):
    """One real lot with date_str set — UC status, NOT eligible for demand allocation."""
    return {
        "lot_id": lot_id,
        "date_dev": date(2025, 1, 1),
        "date_td": date(2025, 3, 1),
        "date_td_hold": None,
        "date_str": date(2025, 5, 1),
        "building_group_id": None,
    }


def _demand_df(total_slots, start_year=2026, start_month=1):
    """Spread `total_slots` one-per-month across consecutive months."""
    rows = []
    year, month = start_year, start_month
    for _ in range(total_slots):
        rows.append({"year": year, "month": month, "slots": 1})
        month += 1
        if month > 12:
            month = 1
            year += 1
    return pd.DataFrame(rows)


def _one_phase(capacity, phase_id=1, dev_id=1, lot_type_id=101):
    """Single-phase capacity list with `capacity` available slots."""
    return [
        {
            "phase_id": phase_id,
            "dev_id": dev_id,
            "lot_type_id": lot_type_id,
            "available_slots": capacity,
            "date_dev": date(2025, 6, 1),
        }
    ]


# ─────────────────────────────────────────────────────────────
# TEST 1: Happy path — all real lots already started (UC)
# ─────────────────────────────────────────────────────────────

def test_happy_path_all_lots_started():
    """
    5 real lots all UC (date_str set). None eligible for demand allocation.
    All 10 demand slots become unmet -> 10 temp lots generated.
    """
    lot_snapshot = pd.DataFrame([_uc_lot(i) for i in range(1, 6)])

    frozen = _make_frozen_input(
        lot_snapshot=lot_snapshot,
        demand_series=_demand_df(10),
        phase_capacity=_one_phase(15),
    )

    proposal = plan(frozen)

    assert proposal.allocations_df.empty, (
        f"No eligible lots — allocations_df must be empty, got {len(proposal.allocations_df)} rows"
    )
    assert len(proposal.temp_lots) == 10, (
        f"Expected 10 temp lots (all demand unmet), got {len(proposal.temp_lots)}"
    )
    assert proposal.discarded_lots == [], (
        f"Expected no discards, got {proposal.discarded_lots}"
    )
    for i, lot in enumerate(proposal.temp_lots):
        assert lot["date_td"] == lot["date_str"], (
            f"D-142 violated on temp lot {i}: date_td={lot['date_td']} != date_str={lot['date_str']}"
        )
        assert lot["date_dev"] is not None, (
            f"date_dev must be set on temp lot {i}"
        )


# ─────────────────────────────────────────────────────────────
# TEST 2: Real lot pull order — U before H before D
# ─────────────────────────────────────────────────────────────

def test_pull_order_u_before_h_before_d():
    """
    3 lots: one U (date_td set), one H (date_td_hold set), one D (date_dev only).
    Demand = 2 slots. U and H fill the slots; D is never reached.
    """
    lot_snapshot = pd.DataFrame([
        # lot_A — U status: date_td set, date_str null
        {
            "lot_id": 1,
            "date_dev": date(2025, 1, 1),
            "date_td": date(2025, 3, 1),
            "date_td_hold": None,
            "date_str": None,
            "building_group_id": None,
        },
        # lot_B — H status: date_td_hold set, date_td null, date_str null
        {
            "lot_id": 2,
            "date_dev": date(2025, 1, 1),
            "date_td": None,
            "date_td_hold": date(2025, 4, 1),
            "date_str": None,
            "building_group_id": None,
        },
        # lot_C — D status: date_dev set, no td / tdh / str
        {
            "lot_id": 3,
            "date_dev": date(2025, 1, 1),
            "date_td": None,
            "date_td_hold": None,
            "date_str": None,
            "building_group_id": None,
        },
    ])

    frozen = _make_frozen_input(
        lot_snapshot=lot_snapshot,
        demand_series=_demand_df(2),
        phase_capacity=_one_phase(10),
    )

    proposal = plan(frozen)

    assert len(proposal.allocations_df) == 2, (
        f"Expected 2 allocations, got {len(proposal.allocations_df)}"
    )
    assigned_ids = list(proposal.allocations_df["lot_id"])
    assert assigned_ids[0] == 1, (
        f"U lot (id=1) must be assigned first; got order {assigned_ids}"
    )
    assert assigned_ids[1] == 2, (
        f"H lot (id=2) must be assigned second; got order {assigned_ids}"
    )
    assert 3 not in assigned_ids, (
        f"D lot (id=3) must not be assigned (demand exhausted by U and H)"
    )
    assert proposal.temp_lots == [], (
        f"All demand filled by real lots — no temp lots expected, got {len(proposal.temp_lots)}"
    )


# ─────────────────────────────────────────────────────────────
# TEST 3: Phase capacity hard stop
# ─────────────────────────────────────────────────────────────

def test_phase_capacity_hard_stop():
    """
    10 demand slots, phase capacity = 6. Temp lots capped at 6.

    KNOWN GAP: S-0800 prints a capacity-exhausted WARNING to stdout but does NOT
    surface it through any returned data structure. proposal.warnings is populated
    only by S-0820 (post_generation_chronology_guard). With no chronology violations
    on the 6 generated lots, proposal.warnings will be empty.
    TODO: when S-0800 is updated to return warnings through the Proposal interface,
    add: assert len(proposal.warnings) >= 1
    """
    # Must use a non-empty snapshot with at least one row. S-0700 short-circuits
    # on lot_snapshot.empty == True (0 rows), returning no unmet demand.
    # Use 1 UC lot that is not eligible for allocation.
    lot_snapshot = pd.DataFrame([_uc_lot(1)])

    frozen = _make_frozen_input(
        lot_snapshot=lot_snapshot,
        demand_series=_demand_df(10),
        phase_capacity=_one_phase(6),   # capacity < demand
    )

    proposal = plan(frozen)

    assert len(proposal.temp_lots) == 6, (
        f"Expected 6 temp lots (hard cap at phase capacity), got {len(proposal.temp_lots)}"
    )
    assert proposal.discarded_lots == [], (
        f"No chronology violations expected on fresh temp lots"
    )
    # proposal.warnings is intentionally not checked here — see KNOWN GAP above.


# ─────────────────────────────────────────────────────────────
# TEST 4: Building group coupling — tested via building_group_enforcer directly
# ─────────────────────────────────────────────────────────────

def test_building_group_coupling():
    """
    Verifies S-0810: all lots in a building group collapse to MIN(date_str),
    date_cmp is recomputed from the shared date_str, and date_td == date_str (D-142).

    IMPORTANT — WHY THIS DOES NOT GO THROUGH plan():
    S-0800 hardcodes building_group_id = None on every generated temp lot.
    S-0810 only acts on lots with non-None building_group_id.
    Calling plan() through the normal pipeline will never exercise building group
    enforcement — the enforcer receives only None-grouped lots and passes them through.
    This test therefore calls building_group_enforcer directly with manually-
    constructed temp lots that have building_group_id set.

    TODO (D-134): when S-0800 is updated to assign building_group_ids to sim lots
    (planned for WT-CD/WV-CD condo PG setup), rewrite this test to call plan()
    end-to-end and assert on proposal.temp_lots.
    """
    cmp_lag = timedelta(days=_DEFAULT_LAG_CMP_FROM_STR)
    cls_lag = timedelta(days=_DEFAULT_LAG_CLS_FROM_CMP)

    # 4 temp lots all in building_group_id=1 with spread date_str values.
    # MIN(date_str) is date(2026, 1, 1) — all 4 should collapse to it.
    base = date(2026, 1, 1)
    raw_lots = []
    for offset_days in [0, 31, 59, 90]:
        ds = base + timedelta(days=offset_days)
        raw_lots.append({
            "lot_id": None,
            "projection_group_id": 998,
            "phase_id": 1,
            "builder_id": None,
            "lot_source": "sim",
            "lot_number": None,
            "sim_run_id": 1,
            "lot_type_id": 101,
            "building_group_id": 1,
            "date_ent": None,
            "date_dev": date(2025, 6, 1),
            "date_td": ds,
            "date_td_hold": None,
            "date_str": ds,
            "date_str_source": "engine_filled",
            "date_frm": None,
            "date_cmp": ds + cmp_lag,
            "date_cmp_source": "engine_filled",
            "date_cls": ds + cmp_lag + cls_lag,
            "date_cls_source": "engine_filled",
            "created_at": None,
            "updated_at": None,
        })

    enforced = building_group_enforcer(raw_lots)

    assert len(enforced) == 4

    expected_str = base                   # MIN of the four date_str values
    expected_cmp = expected_str + cmp_lag

    for i, lot in enumerate(enforced):
        assert lot["date_str"] == expected_str, (
            f"Lot {i}: date_str not collapsed to MIN — got {lot['date_str']}, expected {expected_str}"
        )
        assert lot["date_cmp"] == expected_cmp, (
            f"Lot {i}: date_cmp not recomputed from shared date_str — "
            f"got {lot['date_cmp']}, expected {expected_cmp}"
        )
        assert lot["date_td"] == lot["date_str"], (
            f"Lot {i}: D-142 violated — date_td={lot['date_td']} != date_str={lot['date_str']}"
        )


# ─────────────────────────────────────────────────────────────
# Standalone runner
# ─────────────────────────────────────────────────────────────

def run_all():
    tests = [
        ("Test 1: Happy path — all lots started",        test_happy_path_all_lots_started),
        ("Test 2: Pull order — U before H before D",     test_pull_order_u_before_h_before_d),
        ("Test 3: Phase capacity hard stop",             test_phase_capacity_hard_stop),
        ("Test 4: Building group coupling (direct)",     test_building_group_coupling),
    ]

    print("=" * 60)
    print("Kernel scenario tests")
    print("=" * 60)

    passed = 0
    for label, fn in tests:
        try:
            fn()
            print(f"  [PASS] {label}")
            passed += 1
        except AssertionError as e:
            print(f"  [FAIL] {label}")
            print(f"         {e}")
        except Exception as e:
            print(f"  [ERROR] {label}")
            print(f"          {type(e).__name__}: {e}")

    print("=" * 60)
    print(f"Result: {passed}/{len(tests)} passed")
    return passed == len(tests)


if __name__ == "__main__":
    ok = run_all()
    sys.exit(0 if ok else 1)
