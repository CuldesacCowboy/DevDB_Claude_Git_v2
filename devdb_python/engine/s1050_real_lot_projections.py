"""
S-1050 real_lot_projections — Write projected STR/CMP/CLS dates to real P lots.

Reads:   sim_lots (real P lots — no actual start, no takedown), sim_dev_params
Writes:  sim_lots.date_str_projected, date_cmp_projected, date_cls_projected
Input:   conn: DBConnection, dev_id: int, run_start_date: date,
         build_lag_curves: dict, rng: random.Random
Rules:   Generates a demand slot series at annual_starts_target pace from sim_dev_params.
         Independent of kernel capacity logic (which subtracts real lots from capacity).
         Clears stale projections on real lots before writing new ones (skips locked lots).
         date_str_projected → date_cmp_projected via str_to_cmp curve (per unit).
         date_cmp_projected → date_cls_projected via cmp_to_cls curve (per unit).
         Returns count of lots projected.
         Not Own: sim lot generation (S-08), demand allocation (S-07), MARKS dates (S-02).
"""

import logging
from datetime import date

import pandas as pd

from .connection import DBConnection
from .s0850_timing_expansion import curves_for, sample_lag

logger = logging.getLogger(__name__)


def write_real_lot_projections(
    conn: DBConnection,
    dev_id: int,
    run_start_date: date,
    build_lag_curves: dict,
    rng,
) -> int:
    """
    Write date_str_projected / date_cmp_projected / date_cls_projected to real
    P lots (no actual start date, no takedown date) for this dev.

    Returns number of lots projected.
    """
    from datetime import timedelta
    from dateutil.relativedelta import relativedelta

    # Pre-clear stale pace projections from prior runs.
    # Excludes HC lots (date_td_hold_projected IS NOT NULL — cleared by S-0760 pre-clear).
    # Excludes D-status lots (date_td_projected IS NOT NULL — S-0770 owns those dates).
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str_projected = NULL,
            date_cmp_projected = NULL,
            date_cls_projected = NULL
        WHERE lot_source = 'real'
          AND dev_id = %s
          AND date_str_is_locked        IS NOT TRUE
          AND date_cmp_is_locked        IS NOT TRUE
          AND date_cls_is_locked        IS NOT TRUE
          AND date_td_hold_projected    IS NULL
          AND date_td_projected         IS NULL
        """,
        (dev_id,),
    )

    # Only pure P/E lots — no pipeline dates at all.
    # D-status lots (date_td_projected set by S-0770) are excluded so the pace model
    # cannot overwrite their correctly-computed STR dates with pace-based nonsense.
    p_lots_df = conn.read_df(
        """
        SELECT lot_id, lot_type_id, building_group_id
        FROM sim_lots
        WHERE lot_source = 'real'
          AND dev_id                    = %s
          AND date_str                  IS NULL
          AND date_td                   IS NULL
          AND date_td_hold              IS NULL
          AND date_td_hold_projected    IS NULL
          AND date_td_projected         IS NULL
          AND excluded                  IS NOT TRUE
          AND date_str_is_locked        IS NOT TRUE
        ORDER BY building_group_id NULLS LAST, lot_id
        """,
        (dev_id,),
    )

    DEFAULT_CMP_LAG = build_lag_curves.get("_default_cmp", 270)
    DEFAULT_CLS_LAG = build_lag_curves.get("_default_cls", 45)

    pace_count = 0

    if not p_lots_df.empty:
        params_df = conn.read_df(
            """
            SELECT annual_starts_target, max_starts_per_month
            FROM sim_dev_params
            WHERE dev_id = %s
            LIMIT 1
            """,
            (dev_id,),
        )
        if not params_df.empty:
            annual_target = float(params_df.iloc[0]["annual_starts_target"])
            max_per_month_raw = params_df.iloc[0]["max_starts_per_month"]
            max_per_month = (
                float(max_per_month_raw)
                if max_per_month_raw is not None and pd.notna(max_per_month_raw)
                else None
            )
            annual_target_int = max(1, int(round(annual_target)))

            # Count actual MARKS starts per calendar year so pace cap accounts for
            # homes already started — projected lots only fill remaining capacity.
            starts_df = conn.read_df(
                """
                SELECT EXTRACT(YEAR FROM date_str)::int AS yr, COUNT(*) AS n
                FROM sim_lots
                WHERE lot_source = 'real'
                  AND dev_id = %s
                  AND date_str IS NOT NULL
                GROUP BY yr
                """,
                (dev_id,),
            )
            year_consumed: dict[int, int] = {
                int(r["yr"]): int(r["n"]) for _, r in starts_df.iterrows()
            }

            # Build scheduling units — lots in the same building group start together (D-022).
            # Each unit is a list of lot rows; ungrouped lots are singleton units.
            units: list[list] = []
            seen_bgs: set[int] = set()
            for _, lot in p_lots_df.iterrows():
                raw_bg = lot.get("building_group_id")
                if raw_bg is not None and pd.notna(raw_bg):
                    bg_id = int(raw_bg)
                    if bg_id in seen_bgs:
                        continue
                    seen_bgs.add(bg_id)
                    mates = p_lots_df[
                        p_lots_df["building_group_id"].apply(
                            lambda x, _bg=bg_id: x is not None and pd.notna(x) and int(x) == _bg
                        )
                    ].to_dict("records")
                    units.append(mates)
                else:
                    units.append([lot.to_dict()])

            # Assign one start date per scheduling unit, consuming group_size slots,
            # skipping to the next year when annual cap is exhausted.
            current = run_start_date.replace(day=1)
            unit_dates: list[date] = []

            for unit in units:
                group_size = len(unit)
                while True:
                    yr = current.year
                    consumed = year_consumed.get(yr, 0)
                    remaining = annual_target_int - consumed
                    if remaining >= group_size:
                        unit_dates.append(current)
                        year_consumed[yr] = consumed + group_size
                        current = current + relativedelta(months=1)
                        break
                    else:
                        current = date(yr + 1, 1, 1)

            updates = []
            for unit, str_date in zip(units, unit_dates):
                for lot in unit:
                    raw_lt = lot.get("lot_type_id")
                    lt_id = int(raw_lt) if raw_lt is not None and pd.notna(raw_lt) else None
                    str_cmp_curve = curves_for(build_lag_curves, "str_to_cmp", lt_id)
                    cmp_cls_curve = curves_for(build_lag_curves, "cmp_to_cls", lt_id)
                    lag_str_cmp = sample_lag(rng, str_cmp_curve) if str_cmp_curve else DEFAULT_CMP_LAG
                    lag_cmp_cls = sample_lag(rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG
                    cmp_date = str_date + timedelta(days=lag_str_cmp)
                    cls_date = cmp_date + timedelta(days=lag_cmp_cls)
                    updates.append((int(lot["lot_id"]), str_date, cmp_date, cls_date))

            if updates:
                conn.execute_values(
                    """
                    UPDATE sim_lots AS sl
                    SET date_str_projected = v.str_p::date,
                        date_cmp_projected = v.cmp_p::date,
                        date_cls_projected = v.cls_p::date
                    FROM (VALUES %s) AS v(lot_id, str_p, cmp_p, cls_p)
                    WHERE sl.lot_id = v.lot_id::bigint
                    """,
                    updates,
                )
                pace_count = len(updates)
                logger.info(
                    f"  S-1050: Projected dates written to {pace_count} real P lot(s) for dev {dev_id}."
                )

    # Building-group HC sync — always runs, even when there are no pure P/E lots.
    # Invariant: every lot in a building group must have identical BLDR, STR, CMP,
    # and CLS projected dates.  When some group mates are HC-held (S-0760 owns
    # their dates) and others are D-status (S-0770 wrote earlier, independent dates),
    # the HC mates' dates must win unconditionally.  S-0770 may have written an
    # earlier BLDR for the D-lot (lot can't be taken down before hold releases),
    # so this override replaces the S-0770 values entirely.
    synced = conn.execute(
        """
        UPDATE sim_lots sl
        SET date_td_projected  = mate.bldr_date,
            date_str_projected = mate.str_date,
            date_cmp_projected = mate.cmp_date,
            date_cls_projected = mate.cls_date,
            updated_at = NOW()
        FROM (
            SELECT DISTINCT ON (sl2.building_group_id)
                   sl2.building_group_id,
                   sl2.date_td_projected  AS bldr_date,
                   sl2.date_str_projected AS str_date,
                   sl2.date_cmp_projected AS cmp_date,
                   sl2.date_cls_projected AS cls_date
            FROM sim_lots sl2
            WHERE sl2.dev_id = %s
              AND sl2.lot_source = 'real'
              AND sl2.date_td_hold_projected IS NOT NULL
              AND sl2.date_str_projected IS NOT NULL
              AND sl2.building_group_id IS NOT NULL
            ORDER BY sl2.building_group_id, sl2.lot_id
        ) mate
        WHERE sl.dev_id = %s
          AND sl.lot_source = 'real'
          AND sl.building_group_id = mate.building_group_id
          AND sl.date_td_hold_projected IS NULL
          AND sl.date_str IS NULL
          AND sl.date_str_is_locked IS NOT TRUE
        """,
        (dev_id, dev_id),
    )
    if synced:
        logger.info(
            f"  S-1050: Synced BLDR/STR/CMP/CLS to {synced} D-lot(s) from HC group mates."
        )

    return pace_count
