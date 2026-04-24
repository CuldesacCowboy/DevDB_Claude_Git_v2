"""
tda_checkpoint_assigner -- Assign TDA lots to checkpoints by BLDR date order.

Runs after d_bldr_date_projector so all lots have projected dates.
Sorts all TDA lots by effective BLDR date (earliest first), then fills
checkpoints sequentially: first CP.required lots to CP1, next batch to CP2, etc.

Writes to sim_takedown_lot_assignments (DELETE + INSERT).
Does NOT write any dates -- that's tda_hc_enforcer's job.
"""

import logging
from collections import defaultdict

import pandas as pd
from .connection import DBConnection

logger = logging.getLogger(__name__)


def _effective_bldr_date(lot: dict):
    """Effective projected date for sorting: td > td_projected > td_hold > td_hold_projected > str > dev."""
    for key in ("date_td", "date_td_projected", "date_td_hold", "date_td_hold_projected", "date_str", "date_dev"):
        v = lot.get(key)
        if v is not None and pd.notna(v):
            return pd.Timestamp(v)
    return pd.Timestamp.max


def tda_checkpoint_assigner(conn: DBConnection, lot_snapshot: pd.DataFrame, dev_id: int):
    """
    Assign TDA lots to checkpoints in BLDR-date order.
    Returns dict of {lot_id: checkpoint_id} assignments made.
    """
    if lot_snapshot.empty:
        return {}

    snapshot_lot_ids = lot_snapshot["lot_id"].dropna().astype(int).tolist()
    if not snapshot_lot_ids:
        return {}

    # Find active TDAs covering lots in this snapshot
    tda_lots = conn.read_df(
        """
        SELECT tal.tda_id, tal.lot_id
        FROM sim_takedown_agreement_lots tal
        JOIN sim_takedown_agreements ta ON tal.tda_id = ta.tda_id
        WHERE ta.status = 'active'
          AND tal.lot_id = ANY(%s)
        """,
        (snapshot_lot_ids,),
    )
    if tda_lots.empty:
        return {}

    tda_lot_map = defaultdict(set)
    for _, row in tda_lots.iterrows():
        tda_lot_map[int(row["tda_id"])].add(int(row["lot_id"]))

    lots_dict = {int(row["lot_id"]): row.to_dict() for _, row in lot_snapshot.iterrows()}

    all_assignments = {}  # lot_id -> checkpoint_id

    for tda_id, covered_lot_ids in tda_lot_map.items():
        # Load TDA config
        tda_row = conn.read_df(
            "SELECT tda_id, builder_id FROM sim_takedown_agreements WHERE tda_id = %s",
            (tda_id,),
        )
        if tda_row.empty:
            continue

        raw_builder = tda_row.iloc[0]["builder_id"]
        tda_builder_id = None if (raw_builder is None or pd.isna(raw_builder)) else int(raw_builder)

        # Filter lots by builder match
        tda_snapshot_lots = {}
        for lid in covered_lot_ids:
            if lid not in lots_dict:
                continue
            lot = lots_dict[lid]
            if tda_builder_id is not None:
                raw_ov = lot.get("builder_id_override")
                raw_b = lot.get("builder_id")
                resolved = raw_ov if (raw_ov is not None and pd.notna(raw_ov)) else raw_b
                if resolved is None or pd.isna(resolved):
                    continue
                if int(resolved) != tda_builder_id:
                    continue
            tda_snapshot_lots[lid] = lot

        if not tda_snapshot_lots:
            continue

        # Load checkpoints
        checkpoints = conn.read_df(
            """
            SELECT checkpoint_id, checkpoint_number, lots_required_cumulative, checkpoint_date
            FROM sim_takedown_checkpoints
            WHERE tda_id = %s
            ORDER BY checkpoint_date ASC NULLS LAST, checkpoint_number ASC
            """,
            (tda_id,),
        )
        if checkpoints.empty:
            continue

        valid_cps = []
        for _, cp in checkpoints.iterrows():
            if cp["checkpoint_date"] is None or pd.isna(cp["checkpoint_date"]):
                continue
            raw_req = cp["lots_required_cumulative"]
            if raw_req is None or pd.isna(raw_req):
                continue
            valid_cps.append({
                "cp_id": int(cp["checkpoint_id"]),
                "cp_num": int(cp["checkpoint_number"]) if cp["checkpoint_number"] is not None and pd.notna(cp["checkpoint_number"]) else int(cp["checkpoint_id"]),
                "cp_date": pd.Timestamp(cp["checkpoint_date"]),
                "required": int(raw_req),
            })

        if not valid_cps:
            continue

        # Sort lots by BLDR date
        sorted_lots = sorted(
            tda_snapshot_lots.values(),
            key=lambda l: _effective_bldr_date(l),
        )

        # Clear existing assignments for this TDA's checkpoints
        cp_ids = [c["cp_id"] for c in valid_cps]
        conn.execute(
            "DELETE FROM sim_takedown_lot_assignments WHERE checkpoint_id = ANY(%s)",
            (cp_ids,),
        )

        # Assign lots to checkpoints sequentially
        assigned_count = 0
        cp_idx = 0
        assignment_rows = []

        for lot in sorted_lots:
            while cp_idx < len(valid_cps) and assigned_count >= valid_cps[cp_idx]["required"]:
                cp_idx += 1
            if cp_idx >= len(valid_cps):
                break

            cp = valid_cps[cp_idx]
            lid = int(lot["lot_id"])
            assigned_count += 1
            assignment_rows.append((cp["cp_id"], lid))
            all_assignments[lid] = cp["cp_id"]

        # Write assignments
        if assignment_rows:
            conn.execute_values(
                "INSERT INTO sim_takedown_lot_assignments (checkpoint_id, lot_id) VALUES %s",
                assignment_rows,
            )

        # Log summary
        for cp in valid_cps:
            cp_count = sum(1 for r in assignment_rows if r[0] == cp["cp_id"])
            logger.info(
                f"  tda_checkpoint_assigner: TDA {tda_id} CP{cp['cp_num']}: "
                f"{cp_count}/{cp['required']} lots assigned"
            )

    return all_assignments
