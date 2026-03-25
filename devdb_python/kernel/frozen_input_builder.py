# kernel/frozen_input_builder.py
# build_frozen_input -- explicit shell stage that assembles FrozenInput from DB + snapshot.
#
# Owns:   All DB queries required to populate FrozenInput fields.
#         Deriving building_group_memberships and tda_hold_lot_ids from lot_snapshot.
# Not Own: Simulation logic of any kind. Writing to any table.
#          Deciding what demand is. Deciding which lots are eligible.
#
# Called by: coordinator.run_starts_pipeline, after S-0600 has produced demand_series.
# Returns:   FrozenInput ready to pass to plan().

import pandas as pd

from .frozen_input import FrozenInput


def build_frozen_input(
    conn,
    projection_group_id: int,
    lot_snapshot: pd.DataFrame,
    demand_series,
    sim_run_id: int,
) -> FrozenInput:
    """
    Assemble a FrozenInput for one projection group run.

    DB queries (phase capacity, lot-type-to-PG map) are performed here.
    building_group_memberships and tda_hold_lot_ids are derived from lot_snapshot.
    No simulation logic. Returns FrozenInput only.
    """
    phase_capacity = _load_phase_capacity(conn, projection_group_id)
    lot_type_pg_map = _build_lot_type_pg_map(conn, phase_capacity)

    building_group_memberships = {
        int(row['lot_id']): row['building_group_id']
        for _, row in lot_snapshot.iterrows()
        if pd.notna(row.get('building_group_id'))
    }

    tda_hold_lot_ids = set(
        lot_snapshot.loc[
            lot_snapshot['date_td_hold'].notna() & lot_snapshot['date_td'].isna(),
            'lot_id'
        ]
    )

    return FrozenInput(
        lot_snapshot=lot_snapshot,
        demand_series=demand_series,
        phase_capacity=phase_capacity,
        lot_type_pg_map=lot_type_pg_map,
        building_group_memberships=building_group_memberships,
        tda_hold_lot_ids=tda_hold_lot_ids,
        sim_run_id=sim_run_id,
        projection_group_id=projection_group_id,
    )


def _load_phase_capacity(conn, projection_group_id: int) -> list:
    """
    Load sim_phase_product_splits joined with date_dev_projected and real lot counts.
    Scoped to phases belonging to the development that owns this projection group.
    Returns list of dicts with phase_id, dev_id, lot_type_id, available_slots, date_dev.
    """
    df = conn.read_df(f"""
        SELECT
            sps.phase_id,
            sdp.dev_id,
            sps.lot_type_id,
            sps.lot_count,
            sdp.date_dev_projected,
            COALESCE(real.real_count, 0) AS real_lot_count
        FROM sim_phase_product_splits sps
        JOIN sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        LEFT JOIN (
            SELECT phase_id, lot_type_id, COUNT(*) AS real_count
            FROM sim_lots
            WHERE projection_group_id = {projection_group_id}
              AND lot_source = 'real'
            GROUP BY phase_id, lot_type_id
        ) real ON sps.phase_id = real.phase_id AND sps.lot_type_id = real.lot_type_id
        WHERE sdp.dev_id = (
            SELECT dev_id FROM dim_projection_groups
            WHERE projection_group_id = {projection_group_id}
        )
        ORDER BY sdp.sequence_number ASC, sdp.phase_id ASC
    """)

    result = []
    for _, row in df.iterrows():
        available = int(row["lot_count"]) - int(row["real_lot_count"])
        if available > 0:
            d = row["date_dev_projected"]
            if d is not None and hasattr(d, 'date'):
                d = d.date()
            result.append({
                "phase_id":        int(row["phase_id"]),
                "dev_id":          int(row["dev_id"]),
                "lot_type_id":     int(row["lot_type_id"]),
                "available_slots": available,
                "date_dev":        d,
            })
    return result


def _build_lot_type_pg_map(conn, phase_capacity: list) -> dict:
    """
    Build {(dev_id, phase_lot_type_id): projection_group_id} via the correct join:
      sim_phase_product_splits.lot_type_id
        -> ref_lot_types.proj_lot_type_group_id
        -> dim_projection_groups.lot_type_id -> projection_group_id

    Key is (dev_id, phase_lot_type_id) so the same phase lot type in different
    developments resolves to distinct projection groups (D-105).
    """
    if not phase_capacity:
        return {}

    pairs = {(pc["dev_id"], pc["lot_type_id"]) for pc in phase_capacity}
    conditions = " OR ".join(
        f"(sdp.dev_id = {dev_id} AND sps.lot_type_id = {lt_id})"
        for dev_id, lt_id in pairs
    )
    df = conn.read_df(f"""
        SELECT DISTINCT sdp.dev_id, sps.lot_type_id AS phase_lot_type_id,
               dpg.projection_group_id
        FROM sim_dev_phases sdp
        JOIN sim_phase_product_splits sps ON sdp.phase_id = sps.phase_id
        JOIN ref_lot_types rlt_phase ON sps.lot_type_id = rlt_phase.lot_type_id
        JOIN dim_projection_groups dpg ON sdp.dev_id = dpg.dev_id
        JOIN ref_lot_types rlt_pg
          ON dpg.lot_type_id = rlt_pg.lot_type_id
          AND rlt_phase.proj_lot_type_group_id = rlt_pg.proj_lot_type_group_id
        WHERE {conditions}
    """)

    return {
        (int(r["dev_id"]), int(r["phase_lot_type_id"])): int(r["projection_group_id"])
        for _, r in df.iterrows()
    }
