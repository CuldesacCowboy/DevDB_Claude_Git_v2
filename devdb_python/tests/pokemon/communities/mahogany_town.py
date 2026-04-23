"""
mahogany_town.py — Johto Station: Mahogany Town
Scenario 13: Late-Year Delivery Window (Nov–Dec)

ENT_GROUP_ID  = 7013
DEV_IDS       = [7013]
Phases        : 70029 (MAH-001..020), 70030 (MAH-021..040), 70031 (MAH-041..060)
Locked event  : 2022-11-01 on phase 70029
Delivery window: Nov (11) – Dec (12), max 1/year
Setup         : None — lots at P status
Assert        : All auto-created delivery event dates fall in months 11 or 12

Note: Year-boundary windows (e.g. Nov–Feb crossing Jan) require P-04 support for
window_start > window_end. That case is deferred; this scenario uses Nov–Dec.
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from datetime import date
from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator
from tests.pokemon.db import (
    make_lots, reset_mutable_state,
    check_violations, check_sim_lots_exist, check_delivery_events,
    check_no_duplicate_lot_ids,
)

ENT_GROUP_ID   = 7013
ENT_GROUP_NAME = "Johto Station — Mahogany Town"
SCENARIO       = "Scenario 13: Year-Boundary Window (Nov-Feb)"
DEV_IDS        = [7013]


def install(conn) -> None:
    """Insert all permanent objects for Mahogany Town. Idempotent — skips if already installed."""
    exists = conn.read_df(
        "SELECT 1 FROM sim_entitlement_groups WHERE ent_group_id = %s",
        (ENT_GROUP_ID,),
    )
    if not exists.empty:
        return

    county_df = conn.read_df("SELECT county_id FROM dim_county LIMIT 1")
    county_id = int(county_df.iloc[0]["county_id"])
    state_df  = conn.read_df("SELECT state_id FROM dim_state LIMIT 1")
    state_id  = int(state_df.iloc[0]["state_id"])

    conn.execute(
        """
        INSERT INTO sim_entitlement_groups (ent_group_id, ent_group_name, is_test,
            created_at, updated_at)
        VALUES (%s, %s, TRUE, now(), now())
        """,
        (ENT_GROUP_ID, ENT_GROUP_NAME),
    )

    conn.execute(
        """
        INSERT INTO developments (dev_id, dev_name, marks_code, in_marks,
            county_id, state_id, community_id)
        VALUES (%s, %s, %s, FALSE, %s, %s)
        """,
        (7013, "Mahogany Town Retreat", "QM", county_id, state_id, ENT_GROUP_ID),
    )

    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s)",
        (7013, ENT_GROUP_ID, 7013),
    )

    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s)",
        (7013, 101, county_id),
    )

    conn.execute(
        """
        INSERT INTO sim_dev_params (dev_id, annual_starts_target, max_starts_per_month,
            seasonal_weight_set, updated_at)
        VALUES (%s, %s, %s, %s, now())
        ON CONFLICT (dev_id) DO UPDATE SET
            annual_starts_target = EXCLUDED.annual_starts_target,
            max_starts_per_month = EXCLUDED.max_starts_per_month,
            seasonal_weight_set  = EXCLUDED.seasonal_weight_set,
            updated_at           = now()
        """,
        (7013, 24, 2, "balanced_2yr"),
    )

    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70029, 7013, "Mahogany Town Plat No. 1", "plat"),
    )

    for phase_id, name, seq in [
        (70029, "Lake of Rage Ph. 1", 1),
        (70030, "Lake of Rage Ph. 2", 2),
        (70031, "Lake of Rage Ph. 3", 3),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7013, 70029, name, seq),
        )

    lots = (
        make_lots(70029, 7013, 101, "MAH",  1, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70029, "lot_type_id": 101, "projected_count": 20},
        {"phase_id": 70030, "lot_type_id": 101, "projected_count": 20},
        {"phase_id": 70031, "lot_type_id": 101, "projected_count": 20},
    ])

    # Year-boundary window Nov–Feb
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_months,
             min_gap_months, max_deliveries_per_year, updated_at)
        VALUES (%s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, [11,12], 0, 1),
    )

    # Locked delivery event on phase 1 (Nov anchor)
    event_df = conn.read_df(
        """
        INSERT INTO sim_delivery_events
            (ent_group_id, date_dev_actual, date_dev_projected,
             is_auto_created, is_placeholder, created_at, updated_at)
        VALUES (%s, %s, %s, FALSE, FALSE, now(), now())
        RETURNING delivery_event_id
        """,
        (ENT_GROUP_ID, date(2022, 11, 1), date(2022, 11, 1)),
    )
    event_id = int(event_df.iloc[0]["delivery_event_id"])
    conn.execute(
        "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
        (event_id, 70029),
    )


def reset(conn) -> None:
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    pass


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_sim_lots_exist(conn, ENT_GROUP_ID, min_count=1),
        check_no_duplicate_lot_ids(conn, ENT_GROUP_ID),
        check_delivery_events(conn, ENT_GROUP_ID, valid_months=[11,12]),
    ]
    return all(results)
