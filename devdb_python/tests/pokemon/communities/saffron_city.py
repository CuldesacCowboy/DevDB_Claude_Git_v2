"""
saffron_city.py — Kanto Station: Saffron City
Scenario 9: Placeholder Auto-Scheduling

ENT_GROUP_ID  = 7009
DEV_IDS       = [7009]
Phases        : 70018 (SAF-001..020), 70019 (SAF-021..040), 70020 (SAF-041..060)
Locked event  : 2022-07-01 on phase 70018 (anchor for scheduling)
Setup         : None — all lots remain at P status
Assert        : Engine auto-creates 2 delivery events — one each for phases 70019+70020
                (20 permanent D-status lots in phase 70018 mask violation signal;
                 engine uses exhaustion formula rather than co-bundling)
                All auto event dates fall within delivery window
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from datetime import date
from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator
from tests.pokemon.db import (
    make_lots, reset_mutable_state,
    check_violations, check_sim_lots_exist, check_delivery_events,
    check_no_duplicate_lot_ids, _pass,
)

ENT_GROUP_ID   = 7009
ENT_GROUP_NAME = "Kanto Station — Saffron City"
SCENARIO       = "Scenario 9: Placeholder Auto-Scheduling"
DEV_IDS        = [7009]


def install(conn) -> None:
    """Insert all permanent objects for Saffron City. Idempotent — skips if already installed."""
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

    # Entitlement group
    conn.execute(
        """
        INSERT INTO sim_entitlement_groups (ent_group_id, ent_group_name, is_test,
            created_at, updated_at)
        VALUES (%s, %s, TRUE, now(), now())
        """,
        (ENT_GROUP_ID, ENT_GROUP_NAME),
    )

    # Development
    conn.execute(
        """
        INSERT INTO developments (dev_id, dev_name, marks_code, in_marks,
            county_id, state_id, community_id)
        VALUES (%s, %s, %s, FALSE, %s, %s, %s)
        """,
        (7009, "Saffron City Heights", "QI", county_id, state_id, ENT_GROUP_ID),
    )

    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7009, ENT_GROUP_ID, 7009),
    )

    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7009, 101, county_id),
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
        (7009, 24, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70018, 7009, "Saffron City Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70018, "Silph Co. Ph. 1", 1),
        (70019, "Silph Co. Ph. 2", 2),
        (70020, "Silph Co. Ph. 3", 3),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7009, 70018, name, seq),
        )

    # Lots
    lots = (
        make_lots(70018, 7009, 101, "SAF",  1, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70018, "lot_type_id": 101, "projected_count": 20},
        {"phase_id": 70019, "lot_type_id": 101, "projected_count": 20},
        {"phase_id": 70020, "lot_type_id": 101, "projected_count": 20},
    ])

    # Delivery config — auto-scheduling enabled
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_months,
             min_gap_months, max_deliveries_per_year, auto_schedule_enabled, updated_at)
        VALUES (%s, %s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, [5,6,7,8,9,10,11], 0, 2, True),
    )

    # Locked delivery event for phase 1 (anchor)
    event_df = conn.read_df(
        """
        INSERT INTO sim_delivery_events
            (ent_group_id, date_dev_actual, date_dev_projected,
             is_auto_created, is_placeholder, created_at, updated_at)
        VALUES (%s, %s, %s, FALSE, FALSE, now(), now())
        RETURNING delivery_event_id
        """,
        (ENT_GROUP_ID, date(2022, 7, 1), date(2022, 7, 1)),
    )
    event_id = int(event_df.iloc[0]["delivery_event_id"])
    conn.execute(
        "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
        (event_id, 70018),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """No additional date state — all lots remain at P status for auto-scheduling test."""
    pass


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_sim_lots_exist(conn, ENT_GROUP_ID, min_count=1),
        check_no_duplicate_lot_ids(conn, ENT_GROUP_ID),
        check_delivery_events(conn, ENT_GROUP_ID, expected_auto=2,
                              valid_months=[5,6,7,8,9,10,11]),
    ]
    return all(results)
