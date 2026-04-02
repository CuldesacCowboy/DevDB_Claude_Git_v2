"""
S-0500 takedown_engine — Enforce TDA checkpoint obligations for lots in the snapshot.

Reads:   sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_agreement_lots (DB)
Writes:  lot snapshot DataFrame (date_td_hold column only)
Input:   lot_snapshot: DataFrame, dev_id: int, conn: DBConnection
Rules:   Per D-087: both date_td AND date_td_hold count toward checkpoint fulfillment.
         Sets date_td_hold on D lots to meet checkpoint obligations.
         Returns (updated_snapshot, residual_gaps). Never blocks run — records gaps.
         Not Own: setting date_td, modifying any lot field besides date_td_hold.
"""

import pandas as pd
from .connection import DBConnection

_DEFAULT_LEAD_DAYS = 16  # days before checkpoint to schedule hold


def takedown_engine(conn: DBConnection, lot_snapshot: pd.DataFrame,
                    dev_id: int):
    """
    Enforce TDA checkpoint obligations.
    Only writes date_td_hold -- never date_td.
    Returns (updated_snapshot, residual_gaps).
    """
    from datetime import timedelta

    if lot_snapshot.empty:
        return lot_snapshot, []

    snapshot_lot_ids = lot_snapshot["lot_id"].dropna().astype(int).tolist()
    if not snapshot_lot_ids:
        return lot_snapshot, []

    ids_sql = ", ".join(str(i) for i in snapshot_lot_ids)

    # Find active TDA agreements covering lots in snapshot
    tda_lots = conn.read_df(f"""
        SELECT tal.tda_id, tal.lot_id
        FROM sim_takedown_agreement_lots tal
        JOIN sim_takedown_agreements ta ON tal.tda_id = ta.tda_id
        WHERE ta.status = 'active'
          AND tal.lot_id IN ({ids_sql})
    """)

    if tda_lots.empty:
        return lot_snapshot, []

    # Group lots by TDA
    from collections import defaultdict
    tda_lot_map = defaultdict(set)
    for _, row in tda_lots.iterrows():
        tda_lot_map[int(row["tda_id"])].add(int(row["lot_id"]))

    # Work on a mutable copy using a dict keyed by lot_id
    df = lot_snapshot.copy()
    lots_dict = {int(row["lot_id"]): row.to_dict() for _, row in df.iterrows()}

    residual_gaps = []

    for tda_id, covered_lot_ids in tda_lot_map.items():
        # Load TDA config + lead days
        tda_row = conn.read_df(f"""
            SELECT tda_id, anchor_date, status, checkpoint_lead_days
            FROM sim_takedown_agreements
            WHERE tda_id = {tda_id}
        """)
        if tda_row.empty:
            continue
        lead = int(tda_row.iloc[0]["checkpoint_lead_days"] or _DEFAULT_LEAD_DAYS)

        # Load checkpoints in order
        checkpoints = conn.read_df(f"""
            SELECT checkpoint_id, checkpoint_number, lots_required_cumulative, checkpoint_date
            FROM sim_takedown_checkpoints
            WHERE tda_id = {tda_id}
            ORDER BY checkpoint_number
        """)
        if checkpoints.empty:
            continue

        # Lots in both TDA coverage and this snapshot
        tda_snapshot_lots = {lid: lots_dict[lid] for lid in covered_lot_ids if lid in lots_dict}

        for _, cp in checkpoints.iterrows():
            cp_id   = int(cp["checkpoint_id"])
            cp_num  = int(cp["checkpoint_number"])
            cp_date = pd.Timestamp(cp["checkpoint_date"])
            required = int(cp["lots_required_cumulative"])
            hold_date = (cp_date - timedelta(days=lead)).date()

            # Count taken down on or before checkpoint (D-087: date_td OR date_td_hold counts)
            count_taken = sum(
                1 for lot in tda_snapshot_lots.values()
                if (lot["date_td"] is not None and pd.notna(lot["date_td"])
                    and pd.Timestamp(lot["date_td"]) <= cp_date)
                or (lot["date_td_hold"] is not None and pd.notna(lot["date_td_hold"])
                    and pd.Timestamp(lot["date_td_hold"]) <= cp_date)
            )

            if count_taken >= required:
                print(f"  TDA {tda_id} CP{cp_num}: Met ({count_taken}/{required})")
                continue

            gap = required - count_taken

            # Available D lots: date_dev set, no date_td, no date_td_hold, no date_str
            available_d = [
                lot for lot in tda_snapshot_lots.values()
                if (lot["date_dev"] is not None and pd.notna(lot["date_dev"]))
                and (lot["date_td"] is None or pd.isna(lot["date_td"]))
                and (lot["date_td_hold"] is None or pd.isna(lot["date_td_hold"]))
                and (lot["date_str"] is None or pd.isna(lot["date_str"]))
            ]

            scheduled = 0
            for lot in available_d:
                if scheduled >= gap:
                    break
                lots_dict[lot["lot_id"]]["date_td_hold"] = hold_date
                count_taken += 1
                scheduled += 1

            if scheduled >= gap:
                print(f"  TDA {tda_id} CP{cp_num}: Managed "
                      f"({scheduled} lots scheduled, hold date {hold_date})")
            else:
                residual = gap - scheduled
                print(f"  TDA {tda_id} CP{cp_num}: At Risk (residual gap = {residual})")
                residual_gaps.append({
                    "tda_id": tda_id,
                    "checkpoint_id": cp_id,
                    "checkpoint_number": cp_num,
                    "checkpoint_date": cp_date,
                    "required": required,
                    "projected": count_taken,
                    "gap": residual,
                })

    # Rebuild DataFrame from mutated dict
    updated_df = pd.DataFrame(list(lots_dict.values()))
    # Restore original column order
    updated_df = updated_df[lot_snapshot.columns.tolist()]
    return updated_df, residual_gaps
