"""
install.py — Pokemon test suite installer.

Usage:
    python -m tests.pokemon.install           # install all communities (idempotent)
    python -m tests.pokemon.install --reset   # drop and reinstall all communities

The installer is idempotent by default: each community's install() skips if its
entitlement group already exists. Pass --reset to wipe all test objects first.
"""

import sys
import argparse

sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), "..", ".."))

from engine.connection import PGConnection as DBConnection
from tests.pokemon import communities
from tests.pokemon.constants import ALL_ENT_GROUP_IDS, AZALEA_DEV_IDS
from tests.pokemon.db import advance_sequences


def _reset_all(conn) -> None:
    """Delete all test objects in dependency order."""
    print("Resetting all test objects...")

    # Collect all dev_ids (including Azalea's extra devs)
    all_dev_ids = list(ALL_ENT_GROUP_IDS) + [d for d in AZALEA_DEV_IDS if d not in ALL_ENT_GROUP_IDS]

    # Delivery event phases
    conn.execute(
        """
        DELETE FROM sim_delivery_event_phases
        WHERE delivery_event_id IN (
            SELECT delivery_event_id FROM sim_delivery_events
            WHERE ent_group_id = ANY(%s)
        )
        """,
        (ALL_ENT_GROUP_IDS,),
    )

    # Delivery events
    conn.execute(
        "DELETE FROM sim_delivery_events WHERE ent_group_id = ANY(%s)",
        (ALL_ENT_GROUP_IDS,),
    )

    # Delivery config
    conn.execute(
        "DELETE FROM sim_entitlement_delivery_config WHERE ent_group_id = ANY(%s)",
        (ALL_ENT_GROUP_IDS,),
    )

    # Lot date violations
    conn.execute(
        """
        DELETE FROM sim_lot_date_violations
        WHERE lot_id IN (
            SELECT lot_id FROM sim_lots WHERE dev_id = ANY(%s)
        )
        """,
        (all_dev_ids,),
    )

    # Lots (real and sim)
    conn.execute(
        "DELETE FROM sim_lots WHERE dev_id = ANY(%s)",
        (all_dev_ids,),
    )

    # Product splits
    conn.execute(
        """
        DELETE FROM sim_phase_product_splits
        WHERE phase_id IN (
            SELECT phase_id FROM sim_dev_phases WHERE dev_id = ANY(%s)
        )
        """,
        (all_dev_ids,),
    )

    # Phases
    conn.execute(
        "DELETE FROM sim_dev_phases WHERE dev_id = ANY(%s)",
        (all_dev_ids,),
    )

    # Legal instruments
    conn.execute(
        "DELETE FROM sim_legal_instruments WHERE dev_id = ANY(%s)",
        (all_dev_ids,),
    )

    # Building groups
    conn.execute(
        "DELETE FROM sim_building_groups WHERE dev_id = ANY(%s)",
        (all_dev_ids,),
    )

    # TDA lots / checkpoints / agreements
    conn.execute(
        """
        DELETE FROM sim_takedown_agreement_lots
        WHERE tda_id IN (
            SELECT tda_id FROM sim_takedown_agreements WHERE dev_id = ANY(%s)
        )
        """,
        (all_dev_ids,),
    )
    conn.execute(
        """
        DELETE FROM sim_takedown_checkpoints
        WHERE tda_id IN (
            SELECT tda_id FROM sim_takedown_agreements WHERE dev_id = ANY(%s)
        )
        """,
        (all_dev_ids,),
    )
    conn.execute(
        "DELETE FROM sim_takedown_agreements WHERE dev_id = ANY(%s)",
        (all_dev_ids,),
    )

    # Dev params / defaults
    conn.execute("DELETE FROM sim_dev_params WHERE dev_id = ANY(%s)", (all_dev_ids,))
    conn.execute("DELETE FROM sim_dev_defaults WHERE dev_id = ANY(%s)", (all_dev_ids,))

    # Ent group dev links
    conn.execute(
        "DELETE FROM sim_ent_group_developments WHERE ent_group_id = ANY(%s)",
        (ALL_ENT_GROUP_IDS,),
    )

    # Developments
    conn.execute("DELETE FROM developments WHERE dev_id = ANY(%s)", (all_dev_ids,))

    # Entitlement groups
    conn.execute(
        "DELETE FROM sim_entitlement_groups WHERE ent_group_id = ANY(%s)",
        (ALL_ENT_GROUP_IDS,),
    )

    print("Reset complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Install Pokemon test communities.")
    parser.add_argument(
        "--reset", action="store_true",
        help="Drop and reinstall all test objects (default: idempotent skip)",
    )
    args = parser.parse_args()

    conn = DBConnection()

    if args.reset:
        _reset_all(conn)

    print(f"\nInstalling {len(communities.ALL)} communities...\n")
    installed = 0
    skipped   = 0

    for module in communities.ALL:
        name = module.__name__.split(".")[-1]
        exists = conn.read_df(
            "SELECT 1 FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (module.ENT_GROUP_ID,),
        )
        if not exists.empty and not args.reset:
            print(f"  [SKIP] {name} (already installed)")
            skipped += 1
            continue

        try:
            module.install(conn)
            print(f"  [OK]   {name}")
            installed += 1
        except Exception as exc:
            print(f"  [FAIL] {name}: {exc}")
            raise

    print(f"\nAdvancing sequences past reserved ceiling...")
    advance_sequences(conn)

    print(f"\nDone. installed={installed} skipped={skipped}")


if __name__ == "__main__":
    main()
