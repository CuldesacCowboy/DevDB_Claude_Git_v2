"""
viridian_city.py — Kanto Station: Viridian City
Scenario 1: Multi-Product Convergence

ENT_GROUP_ID  = 7002
DEV_IDS       = [7002]
Phases        : 70003 (SF), 70004 (Condo), 70005 (SF), 70006 (Condo)
Locked event  : 2022-05-01 on phases 70003+70004
Setup         : VCN-001..010 started
Assert        : 2 auto events — exhaustion fallback schedules 70005 then 70006 separately
                (15 permanent D-status lots in 70003+70004 mask violation signal;
                 engine uses exhaustion formula instead of co-bundling)
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

ENT_GROUP_ID  = 7002
ENT_GROUP_NAME = "Kanto Station — Viridian City"
SCENARIO      = "Scenario 1: Multi-Product Convergence"
DEV_IDS       = [7002]


def install(conn) -> None:
    """Insert all permanent objects for Viridian City. Idempotent — skips if already installed."""
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
        (7002, "Viridian City Mixed Use", "QB", county_id, state_id, ENT_GROUP_ID),
    )

    # Link dev to ent group
    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s)",
        (7002, ENT_GROUP_ID, 7002),
    )

    # Dev defaults
    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s)",
        (7002, 101, county_id),
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
        (7002, 20, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70002, 7002, "Viridian City Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70003, "Gym Badge Court Ph. 1 SF",    1),
        (70004, "Gym Badge Court Ph. 1 Condo", 2),
        (70005, "Gym Badge Court Ph. 2 SF",    3),
        (70006, "Gym Badge Court Ph. 2 Condo", 4),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7002, 70002, name, seq),
        )

    # Lots
    lots = (
        make_lots(70003, 7002, 101, "VCN",  1, 15) +
        make_lots(70004, 7002, 111, "VCN", 16, 10)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70003, "lot_type_id": 101, "projected_count": 15},
        {"phase_id": 70004, "lot_type_id": 111, "projected_count": 10},
        {"phase_id": 70005, "lot_type_id": 101, "projected_count": 15},
        {"phase_id": 70006, "lot_type_id": 111, "projected_count": 10},
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

    # Locked delivery event — covers both SF and Condo phase 1
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

    for phase_id in (70003, 70004):
        conn.execute(
            "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
            (event_id, phase_id),
        )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set scenario-specific date state on real lots."""
    # VCN-001 to VCN-010: started
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_str_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7002
          AND lot_number IN (
              'VCN-001','VCN-002','VCN-003','VCN-004','VCN-005',
              'VCN-006','VCN-007','VCN-008','VCN-009','VCN-010'
          )
        """,
        (date(2023, 1, 1),),
    )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_sim_lots_exist(conn, ENT_GROUP_ID, min_count=5),
        check_delivery_events(conn, ENT_GROUP_ID, expected_auto=2,
                              valid_months=[5,6,7,8,9,10,11]),
    ]
    return all(results)
