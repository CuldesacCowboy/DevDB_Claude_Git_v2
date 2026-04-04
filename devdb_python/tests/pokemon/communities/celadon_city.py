"""
celadon_city.py — Kanto Station: Celadon City
Scenario 4: Real vs Temp Lot Competition

ENT_GROUP_ID  = 7007
DEV_IDS       = [7007]
Phases        : 70015 (CEL-001..020), 70016 (CEL-021..040)
Locked event  : 2022-05-01 on phase 70015
Setup         : CEL-001..012 have actual start dates spread monthly across 2023
Assert        : Engine generates sim lots for remaining demand; actual sources preserved
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from datetime import date
from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator
from tests.pokemon.db import (
    make_lots, reset_mutable_state, get_lot_ids_for_phase,
    check_violations, check_sim_lots_exist, check_delivery_events,
    check_no_duplicate_lot_ids, _pass,
)

ENT_GROUP_ID  = 7007
ENT_GROUP_NAME = "Kanto Station — Celadon City"
SCENARIO      = "Scenario 4: Real vs Temp Lot Competition"
DEV_IDS       = [7007]


def install(conn) -> None:
    """Insert all permanent objects for Celadon City. Idempotent — skips if already installed."""
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
        (7007, "Celadon City Mixed", "CT", county_id, state_id, ENT_GROUP_ID),
    )

    # Link dev to ent group
    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7007, ENT_GROUP_ID, 7007),
    )

    # Dev defaults
    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7007, 101, county_id),
    )

    # Dev params
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
        (7007, 20, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70015, 7007, "Celadon City Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70015, "Rainbow Badge Court Ph. 1", 1),
        (70016, "Rainbow Badge Court Ph. 2", 2),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7007, 70015, name, seq),
        )

    # Lots
    lots = (
        make_lots(70015, 7007, 101, "CEL",  1, 20) +
        make_lots(70016, 7007, 101, "CEL", 21, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70015, "lot_type_id": 101, "lot_count": 20},
        {"phase_id": 70016, "lot_type_id": 101, "lot_count": 20},
    ])

    # Delivery config
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_window_start, delivery_window_end,
             min_gap_months, max_deliveries_per_year, auto_schedule_enabled, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, 5, 11, 0, 1, True),
    )

    # Locked delivery event
    event_df = conn.read_df(
        """
        INSERT INTO sim_delivery_events
            (ent_group_id, date_dev_actual, date_dev_projected,
             is_auto_created, is_placeholder, created_at, updated_at)
        VALUES (%s, %s, %s, FALSE, FALSE, now(), now())
        RETURNING delivery_event_id
        """,
        (ENT_GROUP_ID, date(2022, 5, 1), date(2022, 5, 1)),
    )
    event_id = int(event_df.iloc[0]["delivery_event_id"])

    conn.execute(
        "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
        (event_id, 70015),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set actual start dates on CEL-001..012, spread monthly across 2023."""
    lot_numbers = [f"CEL-{i:03d}" for i in range(1, 13)]
    for i, lot_number in enumerate(lot_numbers):
        conn.execute(
            """
            UPDATE sim_lots
            SET date_str = %s, date_str_source = 'actual'
            WHERE lot_source = 'real' AND dev_id = 7007
              AND lot_number = %s
            """,
            (date(2023, i + 1, 1), lot_number),
        )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID)

    # Real lot actual sources must be preserved
    df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lots
        WHERE lot_source = 'real' AND dev_id = 7007
          AND date_str_source = 'actual'
        """
    )
    n = int(df.iloc[0]["n"]) if not df.empty else 0

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_sim_lots_exist(conn, ENT_GROUP_ID, min_count=1),
        _pass("Real lot actual sources preserved", n == 12, f"actual={n}"),
    ]
    return all(results)
