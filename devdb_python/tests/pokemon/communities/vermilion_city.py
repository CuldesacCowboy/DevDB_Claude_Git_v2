"""
vermilion_city.py — Kanto Station: Vermilion City
Scenario 8: Locked Actuals

ENT_GROUP_ID  = 7005
DEV_IDS       = [7005]
Phases        : 70011 (VRM-001..020), 70012 (VRM-021..040)
Locked event  : 2022-05-01 on phase 70011
Setup         : VRM-001..010 have actual str+cmp; VRM-001..005 have actual cls
Assert        : Engine must not overwrite actual-source dates
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

ENT_GROUP_ID  = 7005
ENT_GROUP_NAME = "Kanto Station — Vermilion City"
SCENARIO      = "Scenario 8: Locked Actuals"
DEV_IDS       = [7005]


def install(conn) -> None:
    """Insert all permanent objects for Vermilion City. Idempotent — skips if already installed."""
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
        (7005, "Vermilion City SF", "VE", county_id, state_id, ENT_GROUP_ID),
    )

    # Link dev to ent group
    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7005, ENT_GROUP_ID, 7005),
    )

    # Dev defaults
    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7005, 101, county_id),
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
        (7005, 20, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70011, 7005, "Vermilion City Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70011, "Thunder Badge Court Ph. 1", 1),
        (70012, "Thunder Badge Court Ph. 2", 2),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7005, 70011, name, seq),
        )

    # Lots
    lots = (
        make_lots(70011, 7005, 101, "VRM",  1, 20) +
        make_lots(70012, 7005, 101, "VRM", 21, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70011, "lot_type_id": 101, "lot_count": 20},
        {"phase_id": 70012, "lot_type_id": 101, "lot_count": 20},
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
        (event_id, 70011),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set actual dates — simulating schedhousedetail actuals that the engine must preserve."""
    # VRM-001 to VRM-010: actual str + cmp
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_str_source = 'actual',
            date_cmp = %s, date_cmp_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7005
          AND lot_number IN (
              'VRM-001','VRM-002','VRM-003','VRM-004','VRM-005',
              'VRM-006','VRM-007','VRM-008','VRM-009','VRM-010'
          )
        """,
        (date(2023, 1, 1), date(2023, 5, 1)),
    )
    # VRM-001 to VRM-005: actual cls
    conn.execute(
        """
        UPDATE sim_lots
        SET date_cls = %s, date_cls_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7005
          AND lot_number IN (
              'VRM-001','VRM-002','VRM-003','VRM-004','VRM-005'
          )
        """,
        (date(2023, 9, 1),),
    )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID)

    # Actual date_str must still be present with source='actual'
    str_df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lots
        WHERE lot_source = 'real' AND dev_id = 7005
          AND date_str_source = 'actual'
        """
    )
    actual_str_count = int(str_df.iloc[0]["n"]) if not str_df.empty else 0

    # Actual date_cmp must still be present with source='actual'
    cmp_df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lots
        WHERE lot_source = 'real' AND dev_id = 7005
          AND date_cmp_source = 'actual'
        """
    )
    actual_cmp_count = int(cmp_df.iloc[0]["n"]) if not cmp_df.empty else 0

    results = [
        _pass("Actual date_str preserved", actual_str_count >= 10,
              f"actual={actual_str_count}"),
        _pass("Actual date_cmp preserved", actual_cmp_count >= 10,
              f"actual={actual_cmp_count}"),
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
    ]
    return all(results)
