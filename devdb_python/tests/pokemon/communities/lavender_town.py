"""
lavender_town.py — Kanto Station: Lavender Town
Scenario 7: Gap-Fill No Anchor (D-084)

ENT_GROUP_ID  = 7006
DEV_IDS       = [7006]
Phases        : 70013 (LAV-001..020), 70014 (LAV-021..040)
Locked event  : 2022-05-01 on phase 70013
Setup         : No date fields set — all NULL
Assert        : P-07 sets date_dev on phase 70013 lots from locked event.
                S-03 must NOT fill forward from only date_dev (D-084 true-gap rule).
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

ENT_GROUP_ID  = 7006
ENT_GROUP_NAME = "Kanto Station — Lavender Town"
SCENARIO      = "Scenario 7: Gap-Fill No Anchor (D-084)"
DEV_IDS       = [7006]


def install(conn) -> None:
    """Insert all permanent objects for Lavender Town. Idempotent — skips if already installed."""
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
        (7006, "Lavender Town SF", "QF", county_id, state_id, ENT_GROUP_ID),
    )

    # Link dev to ent group
    conn.execute(
        "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s)",
        (7006, ENT_GROUP_ID, 7006),
    )

    # Dev defaults
    conn.execute(
        "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s)",
        (7006, 101, county_id),
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
        (7006, 20, 2, "balanced_2yr"),
    )

    # Legal instrument
    conn.execute(
        """
        INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
            instrument_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        """,
        (70013, 7006, "Lavender Town Plat No. 1", "plat"),
    )

    # Phases
    for phase_id, name, seq in [
        (70013, "Ghost Tower Court Ph. 1", 1),
        (70014, "Ghost Tower Court Ph. 2", 2),
    ]:
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (phase_id, 7006, 70013, name, seq),
        )

    # Lots
    lots = (
        make_lots(70013, 7006, 101, "LAV",  1, 20) +
        make_lots(70014, 7006, 101, "LAV", 21, 20)
    )
    conn.executemany_insert("sim_lots", lots)

    # Product splits
    conn.executemany_insert("sim_phase_product_splits", [
        {"phase_id": 70013, "lot_type_id": 101, "projected_count": 20},
        {"phase_id": 70014, "lot_type_id": 101, "projected_count": 20},
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
        (event_id, 70013),
    )


def reset(conn) -> None:
    """Reset mutable engine state before each test run."""
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """No date fields set — all lots remain NULL. Engine must respect D-084 true-gap rule."""
    # Intentionally empty: no dates set. The locked event provides date_dev via P-07.
    pass


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    # Phase 70013 lots should have date_dev from the locked event (via P-07)
    dev_df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lots
        WHERE lot_source = 'real' AND phase_id = 70013
          AND date_dev IS NOT NULL
        """
    )
    n_dev = int(dev_df.iloc[0]["n"]) if not dev_df.empty else 0

    # No lots should have date_str — gap fill must NOT fill forward from only date_dev (D-084)
    str_df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lots
        WHERE lot_source = 'real' AND dev_id = 7006
          AND date_str IS NOT NULL
        """
    )
    n_str = int(str_df.iloc[0]["n"]) if not str_df.empty else 0

    results = [
        _pass("Phase 1 lots have date_dev from locked event", n_dev >= 1,
              f"actual={n_dev}"),
        _pass("No date_str forward-filled (D-084 true-gap rule)", n_str == 0,
              f"actual={n_str}"),
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
    ]
    return all(results)
