"""
goldenrod_city.py — Johto Station: Goldenrod City
Delivery Schedule A: Narrow Delivery Window (Sep–Oct)

ENT_GROUP_ID  = 7011
DEV_IDS       = [7011]
Phases        : 70023 (GLD-001..020), 70024 (GLD-021..040), 70025 (GLD-041..060)
Locked event  : 2022-09-01 on phase 70023
Delivery window: Sep (9) – Oct (10), max 1/year
Setup         : None — lots at P status
Assert        : All auto-created delivery event dates fall in months 9 or 10
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

ENT_GROUP_ID   = 7011
ENT_GROUP_NAME = "Johto Station — Goldenrod City"
SCENARIO       = "DS-A: Narrow Delivery Window (Sep-Oct)"
DEV_IDS        = [7011]


def install(conn) -> None:
    """Insert all permanent objects for Goldenrod City. Idempotent — skips if already installed."""
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
        VALUES (%s, %s, %s, FALSE, %s, %s, %s)
        """,
        (7011, "Goldenrod City Commons", "GC", county_id, state_id, ENT_GROUP_ID),
    )

    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7011, ENT_GROUP_ID, 7011),
    )

    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7011, 101, county_id),
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
        (7011, 24, 2, "balanced_2yr"),
    )

    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70023, 7011, "Goldenrod City Plat No. 1", "plat"),
    )

    for phase_id, name, seq in [
        (70023, "Radio Tower Ph. 1", 1),
        (70024, "Radio Tower Ph. 2", 2),
        (70025, "Radio Tower Ph. 3", 3),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7011, 70023, name, seq),
        )

    lots = (
        make_lots(70023, 7011, 101, "GLD",  1, 20) +
        make_lots(70024, 7011, 101, "GLD", 21, 20) +
        make_lots(70025, 7011, 101, "GLD", 41, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70023, "lot_type_id": 101, "lot_count": 20},
        {"phase_id": 70024, "lot_type_id": 101, "lot_count": 20},
        {"phase_id": 70025, "lot_type_id": 101, "lot_count": 20},
    ])

    # Narrow delivery window: Sep–Oct only, max 1 per year
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_window_start, delivery_window_end,
             min_gap_months, max_deliveries_per_year, auto_schedule_enabled, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, 9, 10, 0, 1, True),
    )

    # Locked delivery event on phase 1 (Sep anchor)
    event_df = conn.read_df(
        """
        INSERT INTO sim_delivery_events
            (ent_group_id, date_dev_actual, date_dev_projected,
             is_auto_created, is_placeholder, created_at, updated_at)
        VALUES (%s, %s, %s, FALSE, FALSE, now(), now())
        RETURNING delivery_event_id
        """,
        (ENT_GROUP_ID, date(2022, 9, 1), date(2022, 9, 1)),
    )
    event_id = int(event_df.iloc[0]["delivery_event_id"])
    conn.execute(
        "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
        (event_id, 70023),
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
        check_delivery_events(conn, ENT_GROUP_ID, window_start=9, window_end=10),
    ]
    return all(results)
