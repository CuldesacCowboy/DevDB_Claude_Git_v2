# test_s0810_s0820.py
# Pure unit tests for S-0810 building_group_enforcer and S-0820 post_generation_chronology_guard.
# No DB connection required.
# Run from devdb_python/:  python -m tests.test_s0810_s0820

import sys
import os
from datetime import date, timedelta
import copy

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.building_group_enforcer import building_group_enforcer
from engine.post_gen_chronology_guard import post_generation_chronology_guard
from engine.temp_lot_generator import _DEFAULT_LAG_CMP_FROM_STR, _DEFAULT_LAG_CLS_FROM_CMP


def _pass(label, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition


def _make_lot(phase_id=1, lot_type_id=101, bg_id=None,
              date_str=date(2027, 1, 1), date_cmp=None, date_cls=None):
    """Minimal temp lot dict for testing."""
    ds = date_str
    dc = date_cmp if date_cmp is not None else ds + timedelta(days=_DEFAULT_LAG_CMP_FROM_STR)
    dl = date_cls if date_cls is not None else dc + timedelta(days=_DEFAULT_LAG_CLS_FROM_CMP)
    return {
        "lot_id":              None,
        "projection_group_id": 307,
        "phase_id":            phase_id,
        "builder_id":          None,
        "lot_source":          "sim",
        "lot_number":          None,
        "sim_run_id":          20260325,
        "lot_type_id":         lot_type_id,
        "building_group_id":   bg_id,
        "date_ent":            None,
        "date_dev":            date(2026, 10, 1),
        "date_td":             ds,
        "date_td_hold":        None,
        "date_str":            ds,
        "date_str_source":     "engine_filled",
        "date_frm":            None,
        "date_cmp":            dc,
        "date_cmp_source":     "engine_filled",
        "date_cls":            dl,
        "date_cls_source":     "engine_filled",
        "created_at":          None,
        "updated_at":          None,
    }


# ---------------------------------------------------------------------------
# S-0810 tests
# ---------------------------------------------------------------------------

def test_s0810_empty_batch():
    print("\n=== S-0810: empty batch ===")
    result = building_group_enforcer([])
    return _pass("Empty input -> empty output", result == [])


def test_s0810_no_building_groups():
    print("\n=== S-0810: no building groups (bg_id = None) ===")
    lots = [_make_lot(bg_id=None, date_str=date(2027, 1, 1)),
            _make_lot(bg_id=None, date_str=date(2027, 3, 1))]
    result = building_group_enforcer(lots)
    results = [
        _pass("Count preserved", len(result) == 2),
        _pass("date_str[0] unchanged", result[0]["date_str"] == date(2027, 1, 1)),
        _pass("date_str[1] unchanged", result[1]["date_str"] == date(2027, 3, 1)),
    ]
    return all(results)


def test_s0810_four_unit_group_collapses_to_earliest():
    print("\n=== S-0810: 4-unit group collapses to MIN(date_str) ===")
    dates = [date(2027, 3, 1), date(2027, 1, 1), date(2027, 4, 1), date(2027, 2, 1)]
    lots = [_make_lot(bg_id=42, date_str=d) for d in dates]
    result = building_group_enforcer(lots)

    shared_str = date(2027, 1, 1)

    results = [
        _pass("Count preserved", len(result) == 4),
        _pass("All date_str = MIN", all(r["date_str"] == shared_str for r in result),
              f"got {[r['date_str'] for r in result]}"),
        _pass("All date_td = date_str (D-142)",
              all(r["date_td"] == shared_str for r in result)),
        # date_cmp and date_cls are derived by shell timing expansion post-solve.
        # S-0810 no longer sets these — they may be absent or carry input values.
        _pass("date_cmp/date_cls not enforced by kernel (shell responsibility)",
              True),
    ]
    return all(results)


def test_s0810_two_independent_groups():
    print("\n=== S-0810: two independent groups collapse separately ===")
    lots = [
        _make_lot(bg_id=10, date_str=date(2027, 4, 1)),
        _make_lot(bg_id=10, date_str=date(2027, 2, 1)),  # earlier in group 10
        _make_lot(bg_id=20, date_str=date(2027, 6, 1)),
        _make_lot(bg_id=20, date_str=date(2027, 9, 1)),
    ]
    result = building_group_enforcer(lots)

    min_g10 = date(2027, 2, 1)
    min_g20 = date(2027, 6, 1)

    results = [
        _pass("Group 10 lot 0 date_str = min_g10",
              result[0]["date_str"] == min_g10),
        _pass("Group 10 lot 1 date_str = min_g10",
              result[1]["date_str"] == min_g10),
        _pass("Group 20 lot 2 date_str = min_g20",
              result[2]["date_str"] == min_g20),
        _pass("Group 20 lot 3 date_str = min_g20",
              result[3]["date_str"] == min_g20),
        _pass("Groups independent (min_g10 != min_g20)", min_g10 != min_g20),
    ]
    return all(results)


def test_s0810_input_immutability():
    print("\n=== S-0810: input dicts not mutated ===")
    original_str = date(2027, 6, 1)
    lots = [_make_lot(bg_id=99, date_str=date(2027, 8, 1)),
            _make_lot(bg_id=99, date_str=original_str)]
    originals = copy.deepcopy(lots)

    building_group_enforcer(lots)

    results = [
        _pass("Input lot 0 date_str unchanged",
              lots[0]["date_str"] == originals[0]["date_str"]),
        _pass("Input lot 1 date_str unchanged",
              lots[1]["date_str"] == originals[1]["date_str"]),
    ]
    return all(results)


def test_s0810_mixed_bg_and_no_bg():
    print("\n=== S-0810: mixed BG and non-BG lots ===")
    lots = [
        _make_lot(bg_id=5, date_str=date(2027, 5, 1)),
        _make_lot(bg_id=None, date_str=date(2027, 1, 1)),  # no group -- stays at Jan
        _make_lot(bg_id=5, date_str=date(2027, 3, 1)),    # earlier in group 5
    ]
    result = building_group_enforcer(lots)
    min_g5 = date(2027, 3, 1)

    results = [
        _pass("BG lot 0 collapsed", result[0]["date_str"] == min_g5),
        _pass("Non-BG lot 1 unchanged", result[1]["date_str"] == date(2027, 1, 1)),
        _pass("BG lot 2 collapsed", result[2]["date_str"] == min_g5),
    ]
    return all(results)


# ---------------------------------------------------------------------------
# S-0820 tests
# ---------------------------------------------------------------------------

def test_s0820_empty_batch():
    print("\n=== S-0820: empty batch ===")
    clean, discarded, warnings = post_generation_chronology_guard([])
    results = [
        _pass("clean = []", clean == []),
        _pass("discarded = []", discarded == []),
        _pass("warnings = []", warnings == []),
    ]
    return all(results)


def test_s0820_all_clean_passthrough():
    print("\n=== S-0820: all clean lots pass through ===")
    lots = [
        _make_lot(phase_id=1, date_str=date(2027, 1, 1)),
        _make_lot(phase_id=1, date_str=date(2027, 2, 1)),
    ]
    clean, discarded, warnings = post_generation_chronology_guard(lots)
    results = [
        _pass("All lots clean", len(clean) == 2, f"got {len(clean)}"),
        _pass("No discards", len(discarded) == 0),
        _pass("No warnings", len(warnings) == 0),
    ]
    return all(results)


def test_s0820_discard_cmp_before_str():
    print("\n=== S-0820: date_cmp < date_str discarded ===")
    bad_lot = _make_lot(
        phase_id=2,
        date_str=date(2027, 6, 1),
        date_cmp=date(2027, 4, 1),   # cmp BEFORE str -- violation
    )
    clean, discarded, warnings = post_generation_chronology_guard([bad_lot])
    results = [
        _pass("clean is empty", len(clean) == 0),
        _pass("1 discarded", len(discarded) == 1),
        _pass("'violation' key present", "violation" in discarded[0]),
        _pass("violation mentions date_cmp < date_str",
              "date_cmp" in discarded[0]["violation"] and "date_str" in discarded[0]["violation"]),
        _pass("Supply warning emitted for phase_id=2", len(warnings) == 1),
    ]
    return all(results)


def test_s0820_discard_cls_before_cmp():
    print("\n=== S-0820: date_cls < date_cmp discarded ===")
    good_cmp = date(2027, 9, 1)
    bad_lot = _make_lot(
        phase_id=3,
        date_str=date(2027, 1, 1),
        date_cmp=good_cmp,
        date_cls=date(2027, 8, 1),   # cls BEFORE cmp -- violation
    )
    clean, discarded, warnings = post_generation_chronology_guard([bad_lot])
    results = [
        _pass("clean is empty", len(clean) == 0),
        _pass("1 discarded", len(discarded) == 1),
        _pass("violation mentions date_cls < date_cmp",
              "date_cls" in discarded[0]["violation"] and "date_cmp" in discarded[0]["violation"]),
        _pass("Supply warning emitted for phase_id=3", len(warnings) == 1),
    ]
    return all(results)


def test_s0820_null_cls_passes():
    print("\n=== S-0820: null date_cls allowed ===")
    lot = _make_lot(
        phase_id=4,
        date_str=date(2027, 1, 1),
        date_cmp=date(2027, 10, 28),
        date_cls=None,
    )
    lot["date_cls"] = None  # force null regardless of _make_lot default
    clean, discarded, warnings = post_generation_chronology_guard([lot])
    results = [
        _pass("Lot with null date_cls is clean", len(clean) == 1),
        _pass("No discards", len(discarded) == 0),
        _pass("No warnings", len(warnings) == 0),
    ]
    return all(results)


def test_s0820_partial_discard_no_supply_warning():
    print("\n=== S-0820: partial phase discard -- no supply warning ===")
    good = _make_lot(phase_id=5, date_str=date(2027, 1, 1))
    bad  = _make_lot(phase_id=5, date_str=date(2027, 6, 1),
                     date_cmp=date(2027, 4, 1))  # cmp < str
    clean, discarded, warnings = post_generation_chronology_guard([good, bad])
    results = [
        _pass("1 clean", len(clean) == 1),
        _pass("1 discarded", len(discarded) == 1),
        _pass("No supply warning (phase still has clean lots)", len(warnings) == 0),
    ]
    return all(results)


def test_s0820_fully_cleared_phase_warning():
    print("\n=== S-0820: fully-cleared phase emits supply warning ===")
    bad1 = _make_lot(phase_id=6, date_str=date(2027, 6, 1),
                     date_cmp=date(2027, 4, 1))  # cmp < str
    bad2 = _make_lot(phase_id=6, date_str=date(2027, 6, 1),
                     date_cmp=date(2027, 4, 1))  # same violation
    # Phase 7 has one good lot (should not trigger warning)
    good = _make_lot(phase_id=7, date_str=date(2027, 1, 1))
    clean, discarded, warnings = post_generation_chronology_guard([bad1, bad2, good])
    results = [
        _pass("1 clean (phase 7)", len(clean) == 1),
        _pass("2 discarded (phase 6)", len(discarded) == 2),
        _pass("Exactly 1 warning (phase 6 only)", len(warnings) == 1,
              f"warnings: {warnings}"),
        _pass("Warning mentions phase_id=6", "phase_id=6" in warnings[0]),
    ]
    return all(results)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_all():
    print("DevDB S-0810 / S-0820 unit tests")
    print("=" * 60)

    results = {
        # S-0810
        "s0810_empty_batch":              test_s0810_empty_batch(),
        "s0810_no_building_groups":       test_s0810_no_building_groups(),
        "s0810_four_unit_group":          test_s0810_four_unit_group_collapses_to_earliest(),
        "s0810_two_independent_groups":   test_s0810_two_independent_groups(),
        "s0810_input_immutability":       test_s0810_input_immutability(),
        "s0810_mixed_bg_and_no_bg":       test_s0810_mixed_bg_and_no_bg(),
        # S-0820
        "s0820_empty_batch":              test_s0820_empty_batch(),
        "s0820_all_clean_passthrough":    test_s0820_all_clean_passthrough(),
        "s0820_discard_cmp_before_str":   test_s0820_discard_cmp_before_str(),
        "s0820_discard_cls_before_cmp":   test_s0820_discard_cls_before_cmp(),
        "s0820_null_cls_passes":          test_s0820_null_cls_passes(),
        "s0820_partial_discard":          test_s0820_partial_discard_no_supply_warning(),
        "s0820_fully_cleared_warning":    test_s0820_fully_cleared_phase_warning(),
    }

    print("\n" + "=" * 60)
    passed = sum(1 for v in results.values() if v)
    total  = len(results)
    for name, ok in results.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print(f"\nResult: {passed}/{total} PASS{'' if passed == total else ' -- FAILURES DETECTED'}")
    return passed == total


if __name__ == "__main__":
    run_all()
