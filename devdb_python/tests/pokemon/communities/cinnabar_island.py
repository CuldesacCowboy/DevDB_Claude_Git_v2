"""
cinnabar_island.py — Kanto Station: Cinnabar Island
Scenario 10: Persistence Rollback (Idempotency)

ENT_GROUP_ID  = 7010
DEV_IDS       = [7010]
Phases        : 70021 (CIN-001..020), 70022 (CIN-021..040)
Locked event  : 2022-08-01 on phase 70021
Setup         : CIN-001..006: started; 001..003: completed
Assert        : Running coordinator twice yields same sim lot count and no duplicate lot_ids
                (second run must not double-insert or leave stale rows)
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from datetime import date
from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator
from tests.pokemon.db import (
    make_lots, reset_mutable_state,
    check_violations, check_sim_lots_exist,
    check_no_duplicate_lot_ids, _pass,
)

ENT_GROUP_ID   = 7010
ENT_GROUP_NAME = "Kanto Station — Cinnabar Island"
SCENARIO       = "Scenario 10: Persistence Rollback (Idempotency)"
DEV_IDS        = [7010]


def install(conn) -> None:
    """Insert all permanent objects for Cinnabar Island. Idempotent — skips if already installed."""
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
        (7010, "Cinnabar Island Estates", "CI", county_id, state_id, ENT_GROUP_ID),
    )

    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7010, ENT_GROUP_ID, 7010),
    )

    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7010, 101, county_id),
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
        (7010, 24, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70021, 7010, "Cinnabar Island Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70021, "Volcano Crest Ph. 1", 1),
        (70022, "Volcano Crest Ph. 2", 2),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7010, 70021, name, seq),
        )

    # Lots
    lots = (
        make_lots(70021, 7010, 101, "CIN",  1, 20) +
        make_lots(70022, 7010, 101, "CIN", 21, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70021, "lot_type_id": 101, "lot_count": 20},
        {"phase_id": 70022, "lot_type_id": 101, "lot_count": 20},
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
        (ENT_GROUP_ID, date(2022, 8, 1), date(2022, 8, 1)),
    )
    event_id = int(event_df.iloc[0]["delivery_event_id"])
    conn.execute(
        "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
        (event_id, 70021),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set partial pipeline progress on CIN lots."""
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str = %s, date_str_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7010
          AND lot_number IN ('CIN-001','CIN-002','CIN-003','CIN-004','CIN-005','CIN-006')
        """,
        (date(2023, 2, 1),),
    )
    conn.execute(
        """
        UPDATE sim_lots
        SET date_cmp = %s, date_cmp_source = 'actual'
        WHERE lot_source = 'real' AND dev_id = 7010
          AND lot_number IN ('CIN-001','CIN-002','CIN-003')
        """,
        (date(2023, 7, 1),),
    )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    # First run
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    df1 = conn.read_df(
        "SELECT COUNT(*) AS n FROM sim_lots WHERE lot_source = 'sim' AND dev_id = 7010"
    )
    count1 = int(df1.iloc[0]["n"]) if not df1.empty else 0

    # Second run — must produce identical state
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    df2 = conn.read_df(
        "SELECT COUNT(*) AS n FROM sim_lots WHERE lot_source = 'sim' AND dev_id = 7010"
    )
    count2 = int(df2.iloc[0]["n"]) if not df2.empty else 0

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_no_duplicate_lot_ids(conn, ENT_GROUP_ID),
        _pass("Idempotent sim lot count", count1 == count2,
              f"run1={count1} run2={count2}"),
        _pass("Sim lots exist after both runs", count2 > 0, f"actual={count2}"),
    ]
    return all(results)
