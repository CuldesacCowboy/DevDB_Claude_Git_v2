"""
runner.py — Pokemon test suite runner.

Usage:
    python -m tests.pokemon.runner                       # run all scenarios
    python -m tests.pokemon.runner --scenario pallet_town  # run one scenario

Each scenario:
  1. reset()  — clears engine-computed state (sim lots, violations, placeholder events)
  2. setup()  — sets scenario-specific date state on real lots
  3. assert_results()  — runs coordinator and checks assertions

Exit code 0 if all pass, 1 if any fail.
"""

import sys
import argparse

sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), "..", ".."))

from engine.connection import PGConnection as DBConnection
from tests.pokemon import communities
from tests.pokemon.constants import REGISTRY


def _run_scenario(conn, module) -> bool:
    name = module.__name__.split(".")[-1]
    _, description = REGISTRY.get(name, (None, name))
    print(f"\n{'-' * 60}")
    print(f"  {name}  ({description})")
    print(f"{'-' * 60}")

    try:
        print("  [reset]")
        module.reset(conn)
        print("  [setup]")
        module.setup(conn)
        print("  [assert]")
        passed = module.assert_results(conn)
    except Exception as exc:
        print(f"  [ERROR] {exc}")
        return False

    print(f"  >> {'PASS' if passed else 'FAIL'}")
    return passed


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Pokemon test scenarios.")
    parser.add_argument(
        "--scenario", metavar="NAME",
        help="Run a single scenario by module name (e.g. pallet_town)",
    )
    args = parser.parse_args()

    conn = DBConnection()

    if args.scenario:
        module = next(
            (m for m in communities.ALL
             if m.__name__.split(".")[-1] == args.scenario),
            None,
        )
        if module is None:
            print(f"Unknown scenario: {args.scenario}")
            print(f"Available: {', '.join(REGISTRY.keys())}")
            sys.exit(1)
        targets = [module]
    else:
        targets = communities.ALL

    results = {}
    for module in targets:
        name = module.__name__.split(".")[-1]

        # Verify community is installed
        exists = conn.read_df(
            "SELECT 1 FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (module.ENT_GROUP_ID,),
        )
        if exists.empty:
            print(f"\n[SKIP] {name} — not installed. Run: python -m tests.pokemon.install")
            results[name] = None
            continue

        results[name] = _run_scenario(conn, module)

    # Summary
    print(f"\n{'=' * 60}")
    print("  RESULTS")
    print(f"{'=' * 60}")
    passed = failed = skipped = 0
    for name, result in results.items():
        if result is None:
            print(f"  [SKIP] {name}")
            skipped += 1
        elif result:
            print(f"  [PASS] {name}")
            passed += 1
        else:
            print(f"  [FAIL] {name}")
            failed += 1

    print(f"\n  passed={passed}  failed={failed}  skipped={skipped}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
