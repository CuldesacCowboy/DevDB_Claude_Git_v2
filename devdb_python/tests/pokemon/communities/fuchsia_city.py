"""
fuchsia_city.py — Kanto Station: Fuchsia City
Scenario 3: Building Group Close Dates

ENT_GROUP_ID  = 7008
DEV_IDS       = [7008]
Phases        : 70017 (FUC-001..020)
Building groups: 7008..7012 (4 lots each)
Locked event  : 2022-06-01 on phase 70017
Setup         : Groups 7008 (FUC-001..004): str+cmp+cls set (closed)
                Groups 7009 (FUC-005..008): str+cmp set (completed)
                Groups 7010 (FUC-009..012): str set (under construction)
Assert        : 0 violations, sim lots exist, no duplicate lot_ids
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from datetime import date
from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator
from tests.pokemon.db import (
    reset_mutable_state,
    check_violations, check_sim_lots_exist,
    check_no_duplicate_lot_ids, _pass,
)

ENT_GROUP_ID   = 7008
ENT_GROUP_NAME = "Kanto Station — Fuchsia City"
SCENARIO       = "Scenario 3: Building Group Close Dates"
DEV_IDS        = [7008]

_BUILDING_GROUPS = [
    (7008, "Safari Zone Block A"),
    (7009, "Safari Zone Block B"),
    (7010, "Safari Zone Block C"),
    (7011, "Safari Zone Block D"),
    (7012, "Safari Zone Block E"),
]


def install(conn) -> None:
    """Insert all permanent objects for Fuchsia City. Idempotent — skips if already installed."""
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
        (7008, "Fuchsia City Homes", "FC", county_id, state_id, ENT_GROUP_ID),
    )

    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7008, ENT_GROUP_ID, 7008),
    )

    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7008, 101, county_id),
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
        (7008, 20, 2, "balanced_2yr"),
    )

    # Building groups
    for bg_id, bg_name in _BUILDING_GROUPS:
        conn.execute(
            """
            INSERT INTO sim_building_groups (building_group_id, dev_id, building_name,
                building_type, unit_count, created_at)
            VALUES (%s, %s, %s, %s, %s, now())
            """,
            (bg_id, 7008, bg_name, "sf", 4),
        )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70017, 7008, "Fuchsia City Plat No. 1", "plat"),
    )

    # Phase
    conn.execute(
        """
        INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
            sequence_number, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, now(), now())
        """,
        (70017, 7008, 70017, "Safari Zone Court", 1),
    )

    # Lots — 4 lots per building group (20 lots total)
    lots = []
    for i in range(1, 21):
        bg_id = 7008 + (i - 1) // 4
        lots.append({
            "phase_id":          70017,
            "dev_id":            7008,
            "lot_type_id":       101,
            "lot_source":        "real",
            "lot_number":        f"FUC-{i:03d}",
            "builder_id":        None,
            "building_group_id": bg_id,
            "sim_run_id":        None,
        })
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70017, "lot_type_id": 101, "lot_count": 20},
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
        (ENT_GROUP_ID, date(2022, 6, 1), date(2022, 6, 1)),
    )
    event_id = int(event_df.iloc[0]["delivery_event_id"])
    conn.execute(
        "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
        (event_id, 70017),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set date state representing mixed pipeline positions across building groups."""
    # Group 7008 (FUC-001..004): started, completed, closed
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_str_source = 'actual',
            date_cmp = %s, date_cmp_source = 'actual',
            date_cls = %s, date_cls_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7008
          AND lot_number IN ('FUC-001','FUC-002','FUC-003','FUC-004')
        """,
        (date(2022, 9, 1), date(2022, 12, 1), date(2023, 3, 1)),
    )
    # Group 7009 (FUC-005..008): started, completed
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_str_source = 'actual',
            date_cmp = %s, date_cmp_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7008
          AND lot_number IN ('FUC-005','FUC-006','FUC-007','FUC-008')
        """,
        (date(2023, 1, 1), date(2023, 6, 1)),
    )
    # Group 7010 (FUC-009..012): started only
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_str_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7008
          AND lot_number IN ('FUC-009','FUC-010','FUC-011','FUC-012')
        """,
        (date(2023, 4, 1),),
    )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    # Building group assignments must be preserved on real lots
    df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lots
        WHERE lot_source = 'real' AND dev_id = 7008
          AND building_group_id IS NOT NULL
        """
    )
    n = int(df.iloc[0]["n"]) if not df.empty else 0

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_sim_lots_exist(conn, ENT_GROUP_ID, min_count=1),
        check_no_duplicate_lot_ids(conn, ENT_GROUP_ID),
        _pass("Building group assignments preserved", n == 20, f"actual={n}"),
    ]
    return all(results)
