"""
cerulean_city.py — Kanto Station: Cerulean City
Scenario 2: TDA Gap-Fill

ENT_GROUP_ID  = 7004
DEV_IDS       = [7004]
Phases        : 70009 (CER-001..030 condo), 70010 (CER-031..050 condo)
Locked event  : 2022-05-01 on phase 70009
TDA           : tda_id=7001, 30 lots, 2 checkpoints
Setup         : CER-001..010 have date_td_hold; CER-011..020 have date_td
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

ENT_GROUP_ID  = 7004
ENT_GROUP_NAME = "Kanto Station — Cerulean City"
SCENARIO      = "Scenario 2: TDA Gap-Fill"
DEV_IDS       = [7004]


def install(conn) -> None:
    """Insert all permanent objects for Cerulean City. Idempotent — skips if already installed."""
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
        (7004, "Cerulean City Condos", "QD", county_id, state_id, ENT_GROUP_ID),
    )

    # Link dev to ent group
    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7004, ENT_GROUP_ID, 7004),
    )

    # Dev defaults
    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7004, 111, county_id),
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
        (7004, 20, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70009, 7004, "Cerulean City Condo Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70009, "Cascade Badge Condos Ph. 1", 1),
        (70010, "Cascade Badge Condos Ph. 2", 2),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7004, 70009, name, seq),
        )

    # Lots
    lots = (
        make_lots(70009, 7004, 111, "CER",  1, 30) +
        make_lots(70010, 7004, 111, "CER", 31, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70009, "lot_type_id": 111, "projected_count": 30},
        {"phase_id": 70010, "lot_type_id": 111, "projected_count": 20},
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
        (event_id, 70009),
    )

    # TDA
    conn.execute(
        """
        INSERT INTO sim_takedown_agreements (tda_id, ent_group_id, tda_name)
        VALUES (%s, %s, %s)
        """,
        (7001, ENT_GROUP_ID, "Cerulean TDA 1"),
    )

    # TDA checkpoints
    conn.executemany_insert("sim_takedown_checkpoints", [
        {
            "tda_id":              7001,
            "checkpoint_name":     "Checkpoint A",
            "checkpoint_date":     date(2023, 3, 1),
            "lots_required_cumulative": 15,
        },
        {
            "tda_id":              7001,
            "checkpoint_name":     "Checkpoint B",
            "checkpoint_date":     date(2024, 3, 1),
            "lots_required_cumulative": 30,
        },
    ])

    # TDA lot links — get the 30 CER-001..030 lot_ids
    lot_ids = get_lot_ids_for_phase(conn, 70009)
    conn.executemany_insert("sim_takedown_agreement_lots", [
        {"tda_id": 7001, "lot_id": lot_id} for lot_id in lot_ids
    ])


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set TDA date state: td_hold on CER-001..010, td on CER-011..020."""
    # CER-001 to CER-010: date_td_hold (counts toward checkpoint per D-087)
    conn.execute(
        """
        UPDATE sim_lots
        SET date_td_hold = %s
        WHERE lot_source = 'real' AND dev_id = 7004
          AND lot_number IN (
              'CER-001','CER-002','CER-003','CER-004','CER-005',
              'CER-006','CER-007','CER-008','CER-009','CER-010'
          )
        """,
        (date(2022, 12, 1),),
    )
    # CER-011 to CER-020: date_td (also counts per D-087)
    conn.execute(
        """
        UPDATE sim_lots
        SET date_td = %s
        WHERE lot_source = 'real' AND dev_id = 7004
          AND lot_number IN (
              'CER-011','CER-012','CER-013','CER-014','CER-015',
              'CER-016','CER-017','CER-018','CER-019','CER-020'
          )
        """,
        (date(2023, 2, 1),),
    )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lots
        WHERE lot_source = 'real' AND dev_id = 7004
          AND (date_td IS NOT NULL OR date_td_hold IS NOT NULL)
        """
    )
    total_fulfilled = int(df.iloc[0]["n"]) if not df.empty else 0

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        _pass("TDA lots have td/td_hold dates", total_fulfilled >= 20,
              f"actual={total_fulfilled}"),
    ]
    return all(results)
