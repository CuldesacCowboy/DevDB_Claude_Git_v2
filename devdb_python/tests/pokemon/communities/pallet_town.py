"""
pallet_town.py — Kanto Station: Pallet Town
Scenario 5: Happy Path Baseline

ENT_GROUP_ID  = 7001
DEV_IDS       = [7001]
Phases        : 70001 (PLT-001..020, fully covered), 70002 (PLT-021..025, 5 of 20 planned)
Locked event  : 2022-05-01 on phase 70001
Setup         : PLT-001..008 started; 001..005 completed; 001..003 closed
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from datetime import date
from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator
from tests.pokemon.db import (
    make_lots, reset_mutable_state,
    check_violations, check_delivery_events, _pass,
)

ENT_GROUP_ID  = 7001
ENT_GROUP_NAME = "Kanto Station — Pallet Town"
SCENARIO      = "Scenario 5: Happy Path Baseline"
DEV_IDS       = [7001]


def install(conn) -> None:
    """Insert all permanent objects for Pallet Town. Idempotent — skips if already installed."""
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
        (7001, "Pallet Town SF", "QA", county_id, state_id, ENT_GROUP_ID),
    )

    # Link dev to ent group
    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7001, ENT_GROUP_ID, 7001),
    )

    # Dev defaults
    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7001, 101, county_id),
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
        (7001, 24, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70001, 7001, "Pallet Town Plat No. 1", "plat"),
    )

    # Phases
    conn.execute(
        """
        INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
            sequence_number, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, now(), now())
        """,
        (70001, 7001, 70001, "Squirtle Court Ph. 1", 1),
    )
    conn.execute(
        """
        INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
            sequence_number, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, now(), now())
        """,
        (70002, 7001, 70001, "Squirtle Court Ph. 2", 2),
    )

    # Lots — phase 70001 fully covered (20 real); phase 70002 partially covered
    # (5 real of 20 planned) so the engine has 15 sim slots to fill forward.
    lots = (
        make_lots(70001, 7001, 101, "PLT",  1, 20) +
        make_lots(70002, 7001, 101, "PLT", 21,  5)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70001, "lot_type_id": 101, "projected_count": 20},
        {"phase_id": 70002, "lot_type_id": 101, "projected_count": 20},
    ])

    # Delivery config
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_months,
             min_gap_months, max_deliveries_per_year, auto_schedule_enabled, updated_at)
        VALUES (%s, %s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, [5,6,7,8,9,10,11], 0, 1, True),
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
        (event_id, 70001),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set scenario-specific date state on real lots."""
    # PLT-001 to PLT-008: started
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_str_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7001
          AND lot_number IN (
              'PLT-001','PLT-002','PLT-003','PLT-004',
              'PLT-005','PLT-006','PLT-007','PLT-008'
          )
        """,
        (date(2023, 3, 1),),
    )
    # PLT-001 to PLT-005: completed
    conn.execute(
        """
        UPDATE sim_lots
        SET date_cmp = %s, date_cmp_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7001
          AND lot_number IN (
              'PLT-001','PLT-002','PLT-003','PLT-004','PLT-005'
          )
        """,
        (date(2023, 6, 1),),
    )
    # PLT-001 to PLT-003: closed
    conn.execute(
        """
        UPDATE sim_lots
        SET date_cls = %s, date_cls_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7001
          AND lot_number IN ('PLT-001','PLT-002','PLT-003')
        """,
        (date(2023, 9, 1),),
    )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    iterations, _ = convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_delivery_events(conn, ENT_GROUP_ID, expected_auto=1,
                              valid_months=[5,6,7,8,9,10,11]),
        _pass("Convergence within 10 iterations", iterations <= 10, f"actual={iterations}"),
    ]
    return all(results)
