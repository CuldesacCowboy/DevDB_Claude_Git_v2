"""
pewter_city.py — Kanto Station: Pewter City
Scenario 6: Chronology Violation

ENT_GROUP_ID  = 7003
DEV_IDS       = [7003]
Phases        : 70007 (PWT-001..020), 70008 (PWT-021..040)
Locked event  : 2022-05-01 on phase 70007
Setup         : PWT-001..005 have date_cmp BEFORE date_str (violation);
                PWT-006..015 have valid order
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

ENT_GROUP_ID  = 7003
ENT_GROUP_NAME = "Kanto Station — Pewter City"
SCENARIO      = "Scenario 6: Chronology Violation"
DEV_IDS       = [7003]


def install(conn) -> None:
    """Insert all permanent objects for Pewter City. Idempotent — skips if already installed."""
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
        VALUES (%s, %s, %s, FALSE, %s, %s)
        """,
        (7003, "Pewter City SF", "QC", county_id, state_id, ENT_GROUP_ID),
    )

    # Link dev to ent group
    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s)",
        (7003, ENT_GROUP_ID, 7003),
    )

    # Dev defaults
    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s)",
        (7003, 101, county_id),
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
        (7003, 20, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70007, 7003, "Pewter City Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70007, "Boulder Badge Court Ph. 1", 1),
        (70008, "Boulder Badge Court Ph. 2", 2),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7003, 70007, name, seq),
        )

    # Lots
    lots = (
        make_lots(70007, 7003, 101, "PWT",  1, 20) +
        make_lots(70008, 7003, 101, "PWT", 21, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70007, "lot_type_id": 101, "projected_count": 20},
        {"phase_id": 70008, "lot_type_id": 101, "projected_count": 20},
    ])

    # Delivery config
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_months,
             min_gap_months, max_deliveries_per_year, updated_at)
        VALUES (%s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, [5,6,7,8,9,10,11], 0, 1),
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
        (event_id, 70007),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set scenario-specific date state: chronology violations on PWT-001..005."""
    # PWT-001 to PWT-005: date_cmp BEFORE date_str (VIOLATION)
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_cmp = %s
        WHERE lot_source = 'real' AND dev_id = 7003
          AND lot_number IN (
              'PWT-001','PWT-002','PWT-003','PWT-004','PWT-005'
          )
        """,
        (date(2023, 6, 1), date(2023, 1, 1)),
    )
    # PWT-006 to PWT-015: valid chronological order
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_cmp = %s
        WHERE lot_source = 'real' AND dev_id = 7003
          AND lot_number IN (
              'PWT-006','PWT-007','PWT-008','PWT-009','PWT-010',
              'PWT-011','PWT-012','PWT-013','PWT-014','PWT-015'
          )
        """,
        (date(2023, 3, 1), date(2023, 7, 1)),
    )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lot_date_violations v
        JOIN sim_lots sl ON sl.lot_id = v.lot_id
        WHERE sl.dev_id = 7003
        """
    )
    actual = int(df.iloc[0]["n"]) if not df.empty else 0
    results = [
        _pass("Violations detected for inverted dates", actual >= 5,
              f"actual={actual}"),
    ]
    return all(results)
