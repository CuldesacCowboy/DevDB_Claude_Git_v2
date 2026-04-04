# db.py — Shared DB helpers for install and runner.

from .constants import SEQUENCE_CEILING, AZALEA_DEV_IDS


# ── Lot generation ─────────────────────────────────────────────────────────────

def make_lots(phase_id: int, dev_id: int, lot_type_id: int,
              prefix: str, start_n: int, count: int) -> list[dict]:
    """Generate real-lot dicts for bulk insert. All date fields null at install time."""
    return [
        {
            "phase_id":    phase_id,
            "dev_id":      dev_id,
            "lot_type_id": lot_type_id,
            "lot_source":  "real",
            "lot_number":  f"{prefix}-{i:03d}",
            "builder_id":  None,
            "building_group_id": None,
            "sim_run_id":  None,
        }
        for i in range(start_n, start_n + count)
    ]


# ── Mutable state reset ────────────────────────────────────────────────────────

DATE_COLS = [
    "date_ent", "date_dev", "date_td", "date_td_hold",
    "date_str", "date_str_source", "date_frm",
    "date_cmp", "date_cmp_source", "date_cls", "date_cls_source",
    "date_str_projected", "date_cmp_projected", "date_cls_projected",
]

_DATE_NULL_SET = ", ".join(f"{c} = NULL" for c in DATE_COLS)
_LOCK_COLS_RESET = (
    "date_ent_is_locked = FALSE, date_dev_is_locked = FALSE, "
    "date_td_hold_is_locked = FALSE, date_td_is_locked = FALSE, "
    "date_str_is_locked = FALSE, date_frm_is_locked = FALSE, "
    "date_cmp_is_locked = FALSE, date_cls_is_locked = FALSE"
)


def reset_mutable_state(conn, ent_group_id: int) -> None:
    """
    Clear all engine-computed state for a test community before each run:
      - Delete sim lots (engine output)
      - Delete date violations
      - Delete placeholder delivery events (but NOT locked events)
      - Delete auto-created delivery event phase links
      - Reset all date fields on real lots to NULL
      - Reset date_dev_projected and date_dev_demand_derived on phases
    """
    dev_ids = _get_dev_ids(conn, ent_group_id)
    if not dev_ids:
        return

    # Real lot_ids for this community
    lot_id_df = conn.read_df(
        "SELECT lot_id FROM sim_lots WHERE lot_source = 'real' AND dev_id = ANY(%s)",
        (dev_ids,),
    )
    real_lot_ids = [int(r) for r in lot_id_df["lot_id"]] if not lot_id_df.empty else []

    # 1. Delete sim lots
    conn.execute(
        "DELETE FROM sim_lots WHERE lot_source = 'sim' AND dev_id = ANY(%s)",
        (dev_ids,),
    )

    # 2. Delete violations for real lots
    if real_lot_ids:
        conn.execute(
            "DELETE FROM sim_lot_date_violations WHERE lot_id = ANY(%s)",
            (real_lot_ids,),
        )

    # 3. Delete placeholder delivery events + their phase links
    ph_ev_df = conn.read_df(
        """
        SELECT delivery_event_id FROM sim_delivery_events
        WHERE ent_group_id = %s AND date_dev_actual IS NULL
        """,
        (ent_group_id,),
    )
    if not ph_ev_df.empty:
        ph_ev_ids = ph_ev_df["delivery_event_id"].astype(int).tolist()
        conn.execute(
            "DELETE FROM sim_delivery_event_phases WHERE delivery_event_id = ANY(%s)",
            (ph_ev_ids,),
        )
        conn.execute(
            "DELETE FROM sim_delivery_events WHERE delivery_event_id = ANY(%s)",
            (ph_ev_ids,),
        )

    # 4. Reset date fields on real lots
    conn.execute(
        f"UPDATE sim_lots SET {_DATE_NULL_SET}, {_LOCK_COLS_RESET} "
        "WHERE lot_source = 'real' AND dev_id = ANY(%s)",
        (dev_ids,),
    )

    # 5. Reset phase projected/demand dates
    phase_df = conn.read_df(
        "SELECT phase_id FROM sim_dev_phases WHERE dev_id = ANY(%s)",
        (dev_ids,),
    )
    if not phase_df.empty:
        phase_ids = phase_df["phase_id"].astype(int).tolist()
        conn.execute(
            """
            UPDATE sim_dev_phases
            SET date_dev_projected = NULL, date_dev_demand_derived = NULL
            WHERE phase_id = ANY(%s)
            """,
            (phase_ids,),
        )


def _get_dev_ids(conn, ent_group_id: int) -> list[int]:
    df = conn.read_df(
        "SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s",
        (ent_group_id,),
    )
    return df["dev_id"].astype(int).tolist() if not df.empty else []


def get_real_lot_ids(conn, ent_group_id: int) -> list[int]:
    dev_ids = _get_dev_ids(conn, ent_group_id)
    if not dev_ids:
        return []
    df = conn.read_df(
        "SELECT lot_id FROM sim_lots WHERE lot_source = 'real' AND dev_id = ANY(%s)",
        (dev_ids,),
    )
    return df["lot_id"].astype(int).tolist() if not df.empty else []


def get_lot_ids_for_phase(conn, phase_id: int) -> list[int]:
    df = conn.read_df(
        "SELECT lot_id FROM sim_lots WHERE lot_source = 'real' AND phase_id = %s",
        (phase_id,),
    )
    return df["lot_id"].astype(int).tolist() if not df.empty else []


# ── Sequence advancement ───────────────────────────────────────────────────────

def advance_sequences(conn) -> None:
    """
    After inserting test objects with explicit IDs, advance each affected sequence
    past the reserved ceiling so future production inserts never collide.
    """
    for seq_name, ceiling in SEQUENCE_CEILING.items():
        conn.execute(
            f"""
            DO $$ BEGIN
                IF (SELECT last_value FROM {seq_name}) < {ceiling} THEN
                    PERFORM setval('{seq_name}', {ceiling}, true);
                END IF;
            END $$
            """
        )


# ── Assertion helpers ──────────────────────────────────────────────────────────

def _pass(label: str, condition: bool, detail: str = "") -> bool:
    status = "PASS" if condition else "FAIL"
    print(f"    [{status}] {label}" + (f"  ({detail})" if detail else ""))
    return condition


def check_violations(conn, ent_group_id: int, expected_count: int) -> bool:
    dev_ids = _get_dev_ids(conn, ent_group_id)
    if not dev_ids:
        return _pass("Violation count", False, "no dev_ids found")
    df = conn.read_df(
        """
        SELECT COUNT(*) AS n FROM sim_lot_date_violations v
        JOIN sim_lots sl ON sl.lot_id = v.lot_id
        WHERE sl.dev_id = ANY(%s)
        """,
        (dev_ids,),
    )
    actual = int(df.iloc[0]["n"]) if not df.empty else 0
    return _pass(f"Violation count = {expected_count}", actual == expected_count,
                 f"actual={actual}")


def check_sim_lots_exist(conn, ent_group_id: int, min_count: int = 1) -> bool:
    dev_ids = _get_dev_ids(conn, ent_group_id)
    if not dev_ids:
        return _pass("Sim lots exist", False, "no dev_ids found")
    df = conn.read_df(
        "SELECT COUNT(*) AS n FROM sim_lots WHERE lot_source = 'sim' AND dev_id = ANY(%s)",
        (dev_ids,),
    )
    actual = int(df.iloc[0]["n"]) if not df.empty else 0
    return _pass(f"Sim lot count >= {min_count}", actual >= min_count, f"actual={actual}")


def check_delivery_events(conn, ent_group_id: int,
                          expected_auto: int | None = None,
                          window_start: int | None = None,
                          window_end: int | None = None) -> bool:
    df = conn.read_df(
        """
        SELECT date_dev_projected, date_dev_actual, is_auto_created
        FROM sim_delivery_events
        WHERE ent_group_id = %s
        ORDER BY date_dev_projected
        """,
        (ent_group_id,),
    )
    results = []

    if expected_auto is not None:
        auto_count = int((df["is_auto_created"] == True).sum()) if not df.empty else 0
        results.append(_pass(f"Auto events = {expected_auto}", auto_count == expected_auto,
                             f"actual={auto_count}"))

    if window_start is not None and window_end is not None and not df.empty:
        auto_df = df[df["is_auto_created"] == True]
        if not auto_df.empty:
            months = []
            for _, row in auto_df.iterrows():
                d = row["date_dev_projected"]
                if d is not None:
                    m = d.month if hasattr(d, "month") else d.date().month
                    months.append(m)

            if window_start <= window_end:
                in_window = all(window_start <= m <= window_end for m in months)
            else:  # year-boundary window (e.g. Nov-Feb)
                in_window = all(m >= window_start or m <= window_end for m in months)
            results.append(_pass(
                f"All auto dates in window {window_start}-{window_end}",
                in_window,
                f"months={months}",
            ))

    return all(results) if results else True


def check_no_duplicate_lot_ids(conn, ent_group_id: int) -> bool:
    dev_ids = _get_dev_ids(conn, ent_group_id)
    if not dev_ids:
        return True
    df = conn.read_df(
        """
        SELECT lot_id, COUNT(*) AS n FROM sim_lots
        WHERE dev_id = ANY(%s)
        GROUP BY lot_id HAVING COUNT(*) > 1
        """,
        (dev_ids,),
    )
    return _pass("No duplicate lot_ids", df.empty,
                 f"{len(df)} duplicates" if not df.empty else "")
