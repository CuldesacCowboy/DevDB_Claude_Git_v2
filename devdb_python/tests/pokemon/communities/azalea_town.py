"""
azalea_town.py — Johto Station: Azalea Town
Scenario 14: Multi-Dev Urgency Race

ENT_GROUP_ID  = 7014
DEV_IDS       = [7014, 7015, 7016]  (3 devs under 1 entitlement group)
Instruments   : 70032 (dev 7014), 70034 (dev 7015), 70036 (dev 7016)
Phases        : 70032/70033 (dev 7014), 70034/70035 (dev 7015), 70036/70037 (dev 7016)
Lots          : AZA-001..020 (phase 70032), AZA-021..040 (phase 70033)
                AZB-001..020 (phase 70034), AZB-021..040 (phase 70035)
                AZC-001..020 (phase 70036), AZC-021..040 (phase 70037)
Locked events : 2022-05-01 on phases 70032, 70034, 70036 (one per dev)
Setup         : 6 lots per dev started — creates urgency across all three devs
Assert        : Engine bundles multiple devs into same delivery event (D-139),
                no violations, sim lots exist, dates in window
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from datetime import date
from engine.connection import PGConnection as DBConnection
from engine.coordinator import convergence_coordinator
from tests.pokemon.db import (
    make_lots, reset_mutable_state,
    check_violations, check_sim_lots_exist, check_delivery_events,
    check_no_duplicate_lot_ids, _pass,
)

ENT_GROUP_ID   = 7014
ENT_GROUP_NAME = "Johto Station — Azalea Town"
SCENARIO       = "Scenario 14: Multi-Dev Urgency Race"
DEV_IDS        = [7014, 7015, 7016]

# (dev_id, dev_name, marks_code, instrument_id, ph1, ph2, lot_prefix, phase_name_base)
_DEV_CONFIG = [
    (7014, "Azalea Town SF",    "AZ", 70032, 70032, 70033, "AZA", "Slowpoke Well Ph."),
    (7015, "Azalea Town MF",    "AY", 70034, 70034, 70035, "AZB", "Ilex Forest Ph."),
    (7016, "Azalea Town Condo", "AC", 70036, 70036, 70037, "AZC", "Kurt's Workshop Ph."),
]


def install(conn) -> None:
    """Insert all permanent objects for Azalea Town (3 devs). Idempotent."""
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

    for dev_id, dev_name, marks_code, instrument_id, ph1, ph2, prefix, phase_name_base in _DEV_CONFIG:
        # Development
        conn.execute(
            """
            INSERT INTO developments (dev_id, dev_name, marks_code, in_marks,
                county_id, state_id, community_id)
            VALUES (%s, %s, %s, FALSE, %s, %s, %s)
            """,
            (dev_id, dev_name, marks_code, county_id, state_id, ENT_GROUP_ID),
        )

        conn.execute(
            "INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id) VALUES (%s, %s, %s)",
            (dev_id, ENT_GROUP_ID, dev_id),
        )

        conn.execute(
            "INSERT INTO sim_dev_defaults (dev_id, default_lot_type_id, default_county_id) VALUES (%s, %s, %s)",
            (dev_id, 101, county_id),
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
            (dev_id, 20, 2, "balanced_2yr"),
        )

        # Legal instrument
        conn.execute(
            """
            INSERT INTO sim_legal_instruments (instrument_id, dev_id, instrument_name,
                instrument_type, created_at, updated_at)
            VALUES (%s, %s, %s, %s, now(), now())
            """,
            (instrument_id, dev_id, f"{dev_name} Plat No. 1", "plat"),
        )

        # Phases (both reference same instrument_id = ph1)
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (ph1, dev_id, instrument_id, f"{phase_name_base} 1", 1),
        )
        conn.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, dev_id, instrument_id, phase_name,
                sequence_number, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            """,
            (ph2, dev_id, instrument_id, f"{phase_name_base} 2", 2),
        )

        # Lots
        lots = (
            make_lots(ph1, dev_id, 101, prefix,  1, 20) +
            make_lots(ph2, dev_id, 101, prefix, 21, 20)
        )
        conn.executemany_insert("sim_lots", lots)

        conn.executemany_insert("sim_phase_product_splits", [
            {"phase_id": ph1, "lot_type_id": 101, "lot_count": 20},
            {"phase_id": ph2, "lot_type_id": 101, "lot_count": 20},
        ])

        # Locked delivery event for phase 1 of each dev
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
            (event_id, ph1),
        )

    # Delivery config — shared across ent group
    conn.execute(
        """
        INSERT INTO sim_entitlement_delivery_config
            (ent_group_id, delivery_window_start, delivery_window_end,
             min_gap_months, max_deliveries_per_year, auto_schedule_enabled, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now())
        """,
        (ENT_GROUP_ID, 5, 11, 0, 1, True),
    )


def reset(conn) -> None:
    reset_mutable_state(conn, ENT_GROUP_ID)


def setup(conn) -> None:
    """Set start dates on lots from each dev to create urgency across all three."""
    for dev_id, _, _, _, _, _, prefix, _ in _DEV_CONFIG:
        lot_numbers = [f"{prefix}-{i:03d}" for i in range(1, 7)]
        conn.execute(
            """
            UPDATE sim_lots
            SET date_str = %s, date_str_source = 'actual'
            WHERE lot_source = 'real' AND dev_id = %s
              AND lot_number = ANY(%s)
            """,
            (date(2023, 3, 1), dev_id, lot_numbers),
        )


def assert_results(conn) -> bool:
    """Run assertions. Returns True if all pass."""
    convergence_coordinator(ENT_GROUP_ID, rng_seed=42)

    # D-139: multiple devs bundled onto same auto delivery event.
    # At least one auto event should have phase links from more than one dev.
    df = conn.read_df(
        """
        SELECT de.delivery_event_id, COUNT(DISTINCT p.dev_id) AS dev_count
        FROM sim_delivery_events de
        JOIN sim_delivery_event_phases dep ON dep.delivery_event_id = de.delivery_event_id
        JOIN sim_dev_phases p ON p.phase_id = dep.phase_id
        WHERE de.ent_group_id = %s AND de.is_auto_created = TRUE
        GROUP BY de.delivery_event_id
        """,
        (ENT_GROUP_ID,),
    )
    bundled = (not df.empty) and int(df["dev_count"].max()) > 1

    results = [
        check_violations(conn, ENT_GROUP_ID, expected_count=0),
        check_sim_lots_exist(conn, ENT_GROUP_ID, min_count=3),
        check_no_duplicate_lot_ids(conn, ENT_GROUP_ID),
        check_delivery_events(conn, ENT_GROUP_ID, window_start=5, window_end=11),
        _pass("D-139: multi-dev bundling on auto event", bundled,
              f"max_devs_per_event={int(df['dev_count'].max()) if not df.empty else 0}"),
    ]
    return all(results)
