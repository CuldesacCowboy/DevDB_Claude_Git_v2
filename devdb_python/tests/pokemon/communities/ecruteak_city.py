"""
ecruteak_city.py — Johto Station: Ecruteak City
Scenario 12: Min-Gap 18 Months

ENT_GROUP_ID  = 7012
DEV_IDS       = [7012]
Phases        : 70026 (ECR-001..020), 70027 (ECR-021..040), 70028 (ECR-041..060)
Locked event  : 2022-06-01 on phase 70026
Delivery window: May–Nov (5–11), min_gap_months=18, max 2/year
Setup         : None — lots at P status
Assert        : Consecutive auto-created delivery dates are at least 18 months apart
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

ENT_GROUP_ID   = 7012
ENT_GROUP_NAME = "Johto Station — Ecruteak City"
SCENARIO       = "Scenario 12: Min-Gap 18 Months"
DEV_IDS        = [7012]


def install(conn) -> None:
    """Insert all permanent objects for Ecruteak City. Idempotent — skips if already installed."""
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
        (7012, "Ecruteak City Estates", "EC", county_id, state_id, ENT_GROUP_ID),
    )

    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
        (7012, ENT_GROUP_ID, 7012),
    )

    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
        (7012, 101, county_id),
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
        (7012, 24, 2, "balanced_2yr"),
    )

    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70026, 7012, "Ecruteak City Plat No. 1", "plat"),
    )

    for phase_id, name, seq in [
        (70026, "Tin Tower Ph. 1", 1),
        (70027, "Tin Tower Ph. 2", 2),
        (70028, "Tin Tower Ph. 3", 3),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7012, 70026, name, seq),
        )

    lots = (
        make_lots(70026, 7012, 101, "ECR",  1, 20) +
        make_lots(70027, 7012, 101, "ECR", 21, 20) +
        make_lots(70028, 7012, 101, "ECR", 41, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70026, "lot_type_id": 101, "lot_count": 20},
        {"phase_id": 70027, "lot_type_id": 101, "lot_count": 20},
        {"phase_id": 70028, "lot_type_id": 101, "lot_count": 20},
    ])

    # 18-month minimum gap between deliveries
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_window_start, delivery_window_end,
             min_gap_months, max_deliveries_per_year, auto_schedule_enabled, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, 5, 11, 18, 2, True),
    )

    # Locked delivery event on phase 1
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
        (event_id, 70026),
    )


def reset(conn) -> None:
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    pass


def _months_between(d1, d2) -> int:
    """Return integer months between two dates (d2 - d1)."""
    return (d2.year - d1.year) * 12 + (d2.month - d1.month)


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    # Collect auto-created event dates in chronological order
    df = conn.read_df(
        """
        SELECT date_dev_projected FROM sim_delivery_events
        WHERE ent_group_id = %s AND is_auto_created = TRUE
        ORDER BY date_dev_projected
        """,
        (ENT_GROUP_ID,),
    )

    gap_ok = True
    if not df.empty and len(df) >= 2:
        dates = [
            row["date_dev_projected"]
            if hasattr(row["date_dev_projected"], "month")
            else row["date_dev_projected"].date()
            for _, row in df.iterrows()
        ]
        for i in range(1, len(dates)):
            gap = _months_between(dates[i - 1], dates[i])
            if gap < 18:
                gap_ok = False
                break

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_sim_lots_exist(conn, ENT_GROUP_ID, min_count=1),
        check_no_duplicate_lot_ids(conn, ENT_GROUP_ID),
        _pass("Min-gap 18 months between deliveries", gap_ok,
              f"auto_event_count={len(df)}"),
    ]
    return all(results)
