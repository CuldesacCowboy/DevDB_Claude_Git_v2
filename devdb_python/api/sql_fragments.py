# api/sql_fragments.py
# Shared SQL fragment helpers reused across multiple routers.


def lot_status_sql(alias: str = "") -> str:
    """Return the pipeline-status CASE expression for a sim_lots row.

    Uses the date-field precedence defined in CLAUDE.md (D-006):
    OUT > C > UC > H > U > D > E > P

    Args:
        alias: Optional table alias prefix, e.g. "sl" → "sl.date_cls".
               Pass empty string (default) when querying sim_lots directly
               without an alias.
    """
    p = f"{alias}." if alias else ""
    return f"""
        CASE
            WHEN {p}date_cls IS NOT NULL                                   THEN 'OUT'
            WHEN {p}date_cmp IS NOT NULL                                   THEN 'C'
            WHEN {p}date_str IS NOT NULL                                   THEN 'UC'
            WHEN {p}date_td_hold IS NOT NULL AND {p}date_td IS NULL        THEN 'H'
            WHEN {p}date_td IS NOT NULL                                    THEN 'U'
            WHEN {p}date_dev IS NOT NULL                                   THEN 'D'
            WHEN {p}date_ent IS NOT NULL                                   THEN 'E'
            ELSE 'P'
        END"""
