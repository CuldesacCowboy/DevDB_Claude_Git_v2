"""
S-0850 timing_expansion — Derive date_cmp and date_cls from date_str using empirical curves.

Reads:   sim_build_lag_curves (via load_build_lag_curves)
Writes:  nothing — returns modified temp_lots list (in-memory)
Input:   temp_lots: list of dicts, curves: dict, rng: random.Random
Rules:   Building groups share one str_to_cmp lag sample (D-022): lag sampled once per group
         using the first unit's lot_type_id, applied uniformly so all units share date_cmp.
         date_cls is derived per unit independently (D-012/D-075).
         Falls back to default constant lags (_default_cmp / _default_cls keys in curves dict)
         when no empirical curve matches.
         Not Own: lot allocation (S-07), lot generation (S-08), persistence (S-11).
"""

import logging

import pandas as pd

from .connection import DBConnection

logger = logging.getLogger(__name__)


def load_build_lag_curves(conn: DBConnection) -> dict:
    """
    Load sim_build_lag_curves into {(lag_type, lot_type_id): curve_dict}.
    lot_type_id=None rows are the default fallback.
    """
    df = conn.read_df("""
        SELECT lag_type, lot_type_id, p10, p25, p50, p75, p90
        FROM sim_build_lag_curves
    """)
    curves = {}
    for _, r in df.iterrows():
        lt_id = int(r["lot_type_id"]) if pd.notna(r["lot_type_id"]) else None
        curves[(r["lag_type"], lt_id)] = {
            "p10": int(r["p10"]), "p25": int(r["p25"]), "p50": int(r["p50"]),
            "p75": int(r["p75"]), "p90": int(r["p90"]),
        }
    return curves


def curves_for(curves: dict, lag_type: str, lot_type_id) -> dict | None:
    """Return the best-matching curve for a lag_type + lot_type_id."""
    return curves.get((lag_type, lot_type_id)) or curves.get((lag_type, None))


def sample_lag(rng, curve: dict) -> int:
    """
    Sample lag days from a percentile curve using linear interpolation.
    Draws a uniform U from rng, interpolates over the 5 knots.
    """
    import random as _random
    u = rng.random()
    knots = [
        (0.10, curve["p10"]),
        (0.25, curve["p25"]),
        (0.50, curve["p50"]),
        (0.75, curve["p75"]),
        (0.90, curve["p90"]),
    ]
    if u <= knots[0][0]:
        slope = (knots[1][1] - knots[0][1]) / (knots[1][0] - knots[0][0])
        return max(1, round(knots[0][1] - slope * (knots[0][0] - u)))
    if u >= knots[-1][0]:
        slope = (knots[-1][1] - knots[-2][1]) / (knots[-1][0] - knots[-2][0])
        return round(knots[-1][1] + slope * (u - knots[-1][0]))
    for i in range(len(knots) - 1):
        lo_u, lo_v = knots[i]
        hi_u, hi_v = knots[i + 1]
        if lo_u <= u <= hi_u:
            frac = (u - lo_u) / (hi_u - lo_u)
            return round(lo_v + frac * (hi_v - lo_v))
    return curve["p50"]


def timing_expansion(temp_lots: list, curves: dict, rng) -> list:
    """
    Derive date_cmp and date_cls from date_str for each temp lot.

    Building groups share the same str_to_cmp lag (D-022): sampled once per group
    using the first unit's lot_type_id, applied uniformly so all units share date_cmp.
    date_cls is derived per unit independently (D-012/D-075).

    Falls back to default constant lags when no empirical curve is available.
    Default lags are injected into the curves dict as _default_cmp / _default_cls keys
    by the coordinator after loading delivery config.
    """
    from datetime import timedelta

    DEFAULT_CMP_LAG = curves.get("_default_cmp", 270)
    DEFAULT_CLS_LAG = curves.get("_default_cls", 45)

    # Sample one lag per building group so all units share identical CMP and CLS.
    bg_cmp_lag: dict[int, int] = {}
    bg_cls_lag: dict[int, int] = {}
    for lot in temp_lots:
        bg_id = lot.get("building_group_id")
        if bg_id is not None and bg_id not in bg_cmp_lag:
            lt = lot.get("lot_type_id")
            cmp_curve = curves_for(curves, "str_to_cmp", lt)
            cls_curve = curves_for(curves, "cmp_to_cls", lt)
            bg_cmp_lag[bg_id] = sample_lag(rng, cmp_curve) if cmp_curve else DEFAULT_CMP_LAG
            bg_cls_lag[bg_id] = sample_lag(rng, cls_curve) if cls_curve else DEFAULT_CLS_LAG

    result = []
    for lot in temp_lots:
        lot = lot.copy()
        date_str = lot.get("date_str")
        if date_str is None:
            result.append(lot)
            continue

        lot_type_id = lot.get("lot_type_id")
        bg_id = lot.get("building_group_id")

        if bg_id is not None:
            lag_str_cmp = bg_cmp_lag[bg_id]
            lag_cmp_cls = bg_cls_lag[bg_id]
        else:
            cmp_curve = curves_for(curves, "str_to_cmp", lot_type_id)
            cls_curve = curves_for(curves, "cmp_to_cls", lot_type_id)
            lag_str_cmp = sample_lag(rng, cmp_curve) if cmp_curve else DEFAULT_CMP_LAG
            lag_cmp_cls = sample_lag(rng, cls_curve) if cls_curve else DEFAULT_CLS_LAG

        date_cmp = date_str + timedelta(days=lag_str_cmp)
        date_cls = date_cmp + timedelta(days=lag_cmp_cls)

        lot["date_cmp"] = date_cmp
        lot["date_cmp_source"] = "engine_filled"
        lot["date_cls"] = date_cls
        lot["date_cls_source"] = "engine_filled"
        result.append(lot)

    return result
