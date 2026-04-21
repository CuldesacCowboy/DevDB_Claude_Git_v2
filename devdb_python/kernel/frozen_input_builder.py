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


def load_builder_splits(conn) -> dict:
    """
    Load sim_instrument_builder_splits and expand to {phase_id: [{builder_id, share}, ...]}
    by joining to sim_dev_phases. All phases in an instrument share the same splits.
    """
    df = conn.read_df("""
        SELECT sdp.phase_id, sibs.builder_id, sibs.share
        FROM sim_instrument_builder_splits sibs
        JOIN sim_dev_phases sdp ON sdp.instrument_id = sibs.instrument_id
    """)
    splits: dict = {}
    for _, r in df.iterrows():
        pid = int(r["phase_id"])
        if pid not in splits:
            splits[pid] = []
        splits[pid].append({"builder_id": int(r["builder_id"]), "share": r["share"]})
    return splits


def build_frozen_input(
    conn,
    dev_id: int,
    lot_snapshot: pd.DataFrame,
    demand_series,
    sim_run_id: int,
    td_to_str_lag: int = 1,
    sim_floor_date=None,
) -> FrozenInput:
    """
    Assemble a FrozenInput for one development run.

    DB queries (phase capacity) are performed here.
    building_group_memberships and tda_hold_lot_ids are derived from lot_snapshot.
    No simulation logic. Returns FrozenInput only.

    lot_snapshot passed to the kernel is restricted to U-status (date_td set, no date_str)
    and H-status (HC hold set, no date_td) lots only (D-167).  D-status lots have
    date_dev but no date_td; they get projected dates from S-0760 and must not absorb
    demand slots from the sim planning pool — if they did, S-0800 would under-generate
    sim lots for later phases because D-status lots are concentrated in early
    (already-full-of-real-lots) phases.
    """
    phase_capacity = _load_phase_capacity(conn, dev_id)

    # building_group_memberships and tda_hold_lot_ids use full snapshot so all real
    # lot group associations and HC holds are captured regardless of pipeline status.
    building_group_memberships = {
        int(row['lot_id']): row['building_group_id']
        for _, row in lot_snapshot.iterrows()
        if pd.notna(row.get('building_group_id'))
    }

    # Include lots with actual OR projected hold date (D-164 drain-HC-first).
    has_tdh_proj = "date_td_hold_projected" in lot_snapshot.columns
    _hold_mask = lot_snapshot["date_td_hold"].notna()
    if has_tdh_proj:
        _hold_mask = _hold_mask | lot_snapshot["date_td_hold_projected"].notna()
    tda_hold_lot_ids = set(
        lot_snapshot.loc[
            _hold_mask & lot_snapshot["date_td"].isna(),
            "lot_id"
        ]
    )

    phase_building_config = _load_phase_building_config(conn, dev_id)

    # Kernel snapshot: U-status and H-status lots only (D-167).
    # U-status: committed for takedown (date_td actual), not yet started.
    # H-status: HC hold set (actual or projected), not yet taken down.
    # D-status lots (date_dev but no date_td) are excluded — S-0760 projects their
    # dates independently; including them here steals demand from the sim pool.
    _u_mask = lot_snapshot["date_td"].notna() & lot_snapshot["date_str"].isna()
    _h_mask = (
        _hold_mask
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
    )
    kernel_snapshot = lot_snapshot[_u_mask | _h_mask].reset_index(drop=True)

    return FrozenInput(
        lot_snapshot=kernel_snapshot,
        demand_series=demand_series,
        phase_capacity=phase_capacity,
        building_group_memberships=building_group_memberships,
        tda_hold_lot_ids=tda_hold_lot_ids,
        phase_building_config=phase_building_config,
        sim_run_id=sim_run_id,
        dev_id=dev_id,
        td_to_str_lag=td_to_str_lag,
        sim_floor_date=sim_floor_date,
    )


def _load_phase_capacity(conn, dev_id: int) -> list:
    """
    Load sim_phase_product_splits joined with date_dev_projected and real lot counts.
    Scoped to phases belonging to this development.
    Returns list of dicts with phase_id, dev_id, lot_type_id, available_slots, date_dev.
    """
    df = conn.read_df(f"""
        SELECT
            sps.phase_id,
            sdp.dev_id,
            sps.lot_type_id,
            sps.projected_count,
            sdp.date_dev_projected,
            COALESCE(real.real_count, 0) AS real_lot_count
        FROM sim_phase_product_splits sps
        JOIN sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        LEFT JOIN (
            SELECT phase_id, lot_type_id, COUNT(*) AS real_count
            FROM sim_lots
            WHERE dev_id = {dev_id}
              AND lot_source = 'real'
            GROUP BY phase_id, lot_type_id
        ) real ON sps.phase_id = real.phase_id AND sps.lot_type_id = real.lot_type_id
        WHERE sdp.dev_id = {dev_id}
        ORDER BY sdp.delivery_tier ASC NULLS FIRST, sdp.sequence_number ASC, sdp.phase_id ASC
    """)

    result = []
    for _, row in df.iterrows():
        available = int(row["projected_count"]) - int(row["real_lot_count"])
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


def _load_phase_building_config(conn, dev_id: int) -> dict:
    """
    Load sim_phase_building_config for all phases belonging to this development.
    Returns {phase_id: [(building_count, units_per_building), ...]} for phases with config.
    Phases with no rows in sim_phase_building_config are omitted (SF / unconfigured).
    """
    df = conn.read_df(f"""
        SELECT spbc.phase_id, spbc.building_count, spbc.units_per_building
        FROM sim_phase_building_config spbc
        JOIN sim_dev_phases sdp ON sdp.phase_id = spbc.phase_id
        WHERE sdp.dev_id = {dev_id}
        ORDER BY spbc.phase_id, spbc.id
    """)
    config: dict = {}
    for _, row in df.iterrows():
        pid = int(row["phase_id"])
        config.setdefault(pid, []).append(
            (int(row["building_count"]), int(row["units_per_building"]))
        )
    return config
