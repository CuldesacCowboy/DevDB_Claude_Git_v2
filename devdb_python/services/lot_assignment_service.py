# lot_assignment_service.py
# Service layer for lot-to-phase reassignment.
# Accepts a raw psycopg2 connection (autocommit=False).
# All six steps execute inside a single transaction; full rollback on any failure.
# Does NOT involve the planning kernel -- this is a data management operation.

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg2.extras


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class ReassignmentResult:
    success: bool
    transaction: dict = field(default_factory=dict)
    needs_rerun: list[int] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    phase_counts: dict = field(default_factory=dict)
    error: dict | None = None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def reassign_lot_to_phase(
    conn,
    lot_id: int,
    target_phase_id: int,
    changed_by: str,
) -> ReassignmentResult:
    """
    Reassign a real lot from its current phase to target_phase_id.

    conn must be a raw psycopg2 connection (not PGConnection wrapper).
    Transaction is fully managed internally; caller does not commit or rollback.
    """
    try:
        return _execute(conn, lot_id, target_phase_id, changed_by)
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return ReassignmentResult(
            success=False,
            error={"code": "internal_error", "message": str(exc)},
        )


# ---------------------------------------------------------------------------
# Internal implementation
# ---------------------------------------------------------------------------

def _fail(code: str, message: str) -> ReassignmentResult:
    return ReassignmentResult(success=False, error={"code": code, "message": message})


def _maintain_splits(cur, phase_id: int) -> None:
    """Insert splits rows for lot_type_ids with actual > 0 but no row; delete rows where actual = 0 AND lot_count = 0."""
    cur.execute(
        """
        INSERT INTO sim_phase_product_splits (phase_id, lot_type_id, lot_count)
        SELECT %s, actual.lot_type_id, 0
        FROM (
            SELECT lot_type_id
            FROM sim_lots
            WHERE phase_id = %s AND lot_source = 'real'
            GROUP BY lot_type_id
            HAVING COUNT(*) > 0
        ) actual
        WHERE NOT EXISTS (
            SELECT 1 FROM sim_phase_product_splits sps
            WHERE sps.phase_id = %s AND sps.lot_type_id = actual.lot_type_id
        )
        """,
        (phase_id, phase_id, phase_id),
    )
    cur.execute(
        """
        DELETE FROM sim_phase_product_splits
        WHERE phase_id = %s
          AND lot_count = 0
          AND NOT EXISTS (
              SELECT 1 FROM sim_lots sl
              WHERE sl.phase_id = %s AND sl.lot_type_id = sim_phase_product_splits.lot_type_id
                AND sl.lot_source = 'real'
          )
        """,
        (phase_id, phase_id),
    )


def _build_by_lot_type(cur, phase_id: int) -> list:
    """Return full by_lot_type list for a phase by joining splits with actual lot counts."""
    cur.execute(
        """
        SELECT sps.lot_type_id,
               rlt.lot_type_short,
               COALESCE(actual.cnt, 0) AS actual,
               sps.lot_count AS projected,
               GREATEST(COALESCE(actual.cnt, 0), sps.lot_count) AS total
        FROM sim_phase_product_splits sps
        JOIN ref_lot_types rlt ON rlt.lot_type_id = sps.lot_type_id
        LEFT JOIN (
            SELECT lot_type_id, COUNT(*) AS cnt
            FROM sim_lots
            WHERE phase_id = %s AND lot_source = 'real'
            GROUP BY lot_type_id
        ) actual ON actual.lot_type_id = sps.lot_type_id
        WHERE sps.phase_id = %s
        """,
        (phase_id, phase_id),
    )
    return [
        {
            "lot_type_id": int(r["lot_type_id"]),
            "lot_type_short": r["lot_type_short"],
            "actual": int(r["actual"]),
            "projected": int(r["projected"]),
            "total": int(r["total"]),
        }
        for r in cur.fetchall()
    ]


def _execute(conn, lot_id: int, target_phase_id: int, changed_by: str) -> ReassignmentResult:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # ----------------------------------------------------------------
        # Step 1 — Validate
        # ----------------------------------------------------------------

        cur.execute(
            """
            SELECT lot_id, phase_id, lot_source, lot_number, lot_type_id,
                   projection_group_id, date_str, date_cmp, date_cls
            FROM sim_lots
            WHERE lot_id = %s
            """,
            (lot_id,),
        )
        lot = cur.fetchone()
        if lot is None:
            conn.rollback()
            return _fail("lot_not_found", f"Lot {lot_id} not found.")

        if lot["lot_source"] != "real":
            conn.rollback()
            return _fail(
                "lot_source_not_real",
                f"Lot {lot_id} is a sim lot and cannot be manually reassigned. "
                "Modify simulation parameters to change sim lot assignments.",
            )

        cur.execute(
            "SELECT phase_id, dev_id, phase_name FROM sim_dev_phases WHERE phase_id = %s",
            (target_phase_id,),
        )
        target_phase = cur.fetchone()
        if target_phase is None:
            conn.rollback()
            return _fail("phase_not_found", f"Phase {target_phase_id} not found.")

        from_phase_id = lot["phase_id"]

        if from_phase_id is not None:
            # Check both phases are in the same entitlement group
            cur.execute(
                "SELECT dev_id FROM sim_dev_phases WHERE phase_id = %s",
                (from_phase_id,),
            )
            from_phase_row = cur.fetchone()
            from_dev_id = from_phase_row["dev_id"] if from_phase_row else None

            all_dev_ids = list({target_phase["dev_id"], from_dev_id} - {None})
            cur.execute(
                """
                SELECT dev_id, ent_group_id
                FROM sim_ent_group_developments
                WHERE dev_id = ANY(%s)
                """,
                (all_dev_ids,),
            )
            ent_map = {r["dev_id"]: r["ent_group_id"] for r in cur.fetchall()}
            from_ent = ent_map.get(from_dev_id)
            target_ent = ent_map.get(target_phase["dev_id"])

            if from_ent != target_ent or from_ent is None:
                conn.rollback()
                return _fail(
                    "cross_entitlement_group_move",
                    f"Phase {target_phase_id} is not in the same entitlement group "
                    f"as lot {lot['lot_number']}.",
                )

        if from_phase_id == target_phase_id:
            conn.rollback()
            return _fail(
                "already_in_phase",
                f"Lot {lot['lot_number']} is already assigned to phase {target_phase_id}.",
            )

        # ----------------------------------------------------------------
        # Soft warning (checked after validation passes, before writes)
        # ----------------------------------------------------------------
        # Warn only when the lot is operationally active mid-lifecycle:
        #   UC = date_str set, date_cmp null, date_cls null
        #   C  = date_cmp set, date_cls null
        # OUT lots (date_cls set) are fully closed — warning adds no value.
        # U / H / D lots have no downstream actuals yet — no warning needed.
        warnings = []
        has_actual_dates = (
            (lot["date_str"] is not None or lot["date_cmp"] is not None)
            and lot["date_cls"] is None
        )
        if has_actual_dates:
            warnings.append(
                {
                    "code": "actual_dates_present",
                    "message": (
                        f"Lot {lot['lot_number']} is under construction or complete "
                        "with recorded MARKsystems dates. Moving it changes its "
                        "projected delivery context but does not affect its recorded actuals."
                    ),
                }
            )

        # ----------------------------------------------------------------
        # Step 2 — Update lot
        # ----------------------------------------------------------------
        cur.execute(
            "UPDATE sim_lots SET phase_id = %s WHERE lot_id = %s",
            (target_phase_id, lot_id),
        )

        # ----------------------------------------------------------------
        # Step 2b — Maintain sim_phase_product_splits
        # ----------------------------------------------------------------
        for pid in [p for p in [from_phase_id, target_phase_id] if p is not None]:
            _maintain_splits(cur, pid)

        # ----------------------------------------------------------------
        # Step 3 — Set needs_rerun
        # ----------------------------------------------------------------
        # Query after lot update so the moved lot (now in target_phase) is included.
        # Covers the edge case where from_phase has no remaining lots:
        # the moved lot's PG is captured via target_phase_id.
        phase_filter = [p for p in [from_phase_id, target_phase_id] if p is not None]
        cur.execute(
            """
            SELECT DISTINCT projection_group_id
            FROM sim_lots
            WHERE phase_id = ANY(%s)
            """,
            (phase_filter,),
        )
        affected_pg_ids = [int(r["projection_group_id"]) for r in cur.fetchall()]

        if affected_pg_ids:
            cur.execute(
                """
                UPDATE dim_projection_groups
                SET needs_rerun = true
                WHERE projection_group_id = ANY(%s)
                """,
                (affected_pg_ids,),
            )

        # ----------------------------------------------------------------
        # Step 6 — Audit log
        # ----------------------------------------------------------------
        metadata = {
            "lot_number": lot["lot_number"],
            "lot_type_id": lot["lot_type_id"],
            "had_actual_dates": has_actual_dates,
        }
        cur.execute(
            """
            INSERT INTO sim_assignment_log
                (action, resource_type, resource_id,
                 from_owner_id, to_owner_id,
                 changed_by, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                "lot_phase_reassignment",
                "lot",
                lot_id,
                from_phase_id if from_phase_id is not None else 0,
                target_phase_id,
                changed_by,
                psycopg2.extras.Json(metadata),
            ),
        )

        conn.commit()

        # ----------------------------------------------------------------
        # Post-commit: build phase_counts
        # ----------------------------------------------------------------
        from_phase_detail = (
            {
                "phase_id": from_phase_id,
                "by_lot_type": _build_by_lot_type(cur, from_phase_id),
            }
            if from_phase_id is not None
            else {"phase_id": 0, "by_lot_type": []}
        )
        phase_counts = {
            "from_phase": from_phase_detail,
            "to_phase": {
                "phase_id": target_phase_id,
                "by_lot_type": _build_by_lot_type(cur, target_phase_id),
            },
        }

        return ReassignmentResult(
            success=True,
            transaction={
                "action": "lot_phase_reassignment",
                "lot_id": lot_id,
                "lot_number": lot["lot_number"],
                "from_phase_id": from_phase_id if from_phase_id is not None else 0,
                "to_phase_id": target_phase_id,
            },
            needs_rerun=affected_pg_ids,
            warnings=warnings,
            phase_counts=phase_counts,
        )

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Unassign lot from phase (phase_id -> NULL)
# ---------------------------------------------------------------------------

def unassign_lot_from_phase(
    conn,
    lot_id: int,
    changed_by: str,
) -> ReassignmentResult:
    """
    Remove a real lot from its current phase (set phase_id = NULL).
    conn must be a raw psycopg2 connection (not PGConnection wrapper).
    """
    try:
        return _execute_unassign(conn, lot_id, changed_by)
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return ReassignmentResult(
            success=False,
            error={"code": "internal_error", "message": str(exc)},
        )


def _execute_unassign(conn, lot_id: int, changed_by: str) -> ReassignmentResult:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # ----------------------------------------------------------------
        # Step 1 — Validate
        # ----------------------------------------------------------------
        cur.execute(
            """
            SELECT lot_id, phase_id, lot_source, lot_number, lot_type_id,
                   date_str, date_cmp, date_cls
            FROM sim_lots
            WHERE lot_id = %s
            """,
            (lot_id,),
        )
        lot = cur.fetchone()
        if lot is None:
            conn.rollback()
            return _fail("lot_not_found", f"Lot {lot_id} not found.")

        if lot["lot_source"] != "real":
            conn.rollback()
            return _fail(
                "lot_source_not_real",
                f"Lot {lot_id} is a sim lot and cannot be manually unassigned.",
            )

        from_phase_id = lot["phase_id"]
        if from_phase_id is None:
            conn.rollback()
            return _fail(
                "lot_already_unassigned",
                f"Lot {lot['lot_number']} is not assigned to any phase.",
            )

        # ----------------------------------------------------------------
        # Soft warning (UC or C only — same condition as reassignment)
        # ----------------------------------------------------------------
        warnings = []
        has_actual_dates = (
            (lot["date_str"] is not None or lot["date_cmp"] is not None)
            and lot["date_cls"] is None
        )
        if has_actual_dates:
            warnings.append(
                {
                    "code": "actual_dates_present",
                    "message": (
                        f"Lot {lot['lot_number']} is under construction or complete "
                        "with recorded MARKsystems dates. Moving it changes its "
                        "projected delivery context but does not affect its recorded actuals."
                    ),
                }
            )

        # ----------------------------------------------------------------
        # Step 2 — Unassign lot
        # ----------------------------------------------------------------
        cur.execute(
            "UPDATE sim_lots SET phase_id = NULL WHERE lot_id = %s",
            (lot_id,),
        )

        # ----------------------------------------------------------------
        # Step 3 — Set needs_rerun
        # Lot is now unassigned; query remaining lots in from_phase.
        # The moved lot's PG is preserved via projection_group_id on lot itself.
        # ----------------------------------------------------------------
        cur.execute(
            """
            SELECT DISTINCT projection_group_id
            FROM sim_lots
            WHERE phase_id = %s
            """,
            (from_phase_id,),
        )
        affected_pg_ids = [int(r["projection_group_id"]) for r in cur.fetchall()]

        # Also include the unassigned lot's own PG (it may be the last lot in the phase)
        cur.execute(
            "SELECT projection_group_id FROM sim_lots WHERE lot_id = %s",
            (lot_id,),
        )
        own_pg_row = cur.fetchone()
        if own_pg_row and own_pg_row["projection_group_id"] is not None:
            own_pg = int(own_pg_row["projection_group_id"])
            if own_pg not in affected_pg_ids:
                affected_pg_ids.append(own_pg)

        if affected_pg_ids:
            cur.execute(
                """
                UPDATE dim_projection_groups
                SET needs_rerun = true
                WHERE projection_group_id = ANY(%s)
                """,
                (affected_pg_ids,),
            )

        # ----------------------------------------------------------------
        # Step 4 — Audit log
        # ----------------------------------------------------------------
        metadata = {
            "lot_number": lot["lot_number"],
            "lot_type_id": lot["lot_type_id"],
            "had_actual_dates": has_actual_dates,
        }
        cur.execute(
            """
            INSERT INTO sim_assignment_log
                (action, resource_type, resource_id,
                 from_owner_id, to_owner_id,
                 changed_by, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                "lot_phase_unassignment",
                "lot",
                lot_id,
                from_phase_id,
                0,          # NULL represented as 0 per spec
                changed_by,
                psycopg2.extras.Json(metadata),
            ),
        )

        conn.commit()

        # ----------------------------------------------------------------
        # Post-commit: build from_phase_counts
        # ----------------------------------------------------------------
        cur.execute(
            """
            SELECT COUNT(*) AS actual
            FROM sim_lots
            WHERE phase_id = %s AND lot_type_id = %s AND lot_source = 'real'
            """,
            (from_phase_id, lot["lot_type_id"]),
        )
        actual = int(cur.fetchone()["actual"])
        cur.execute(
            """
            SELECT lot_count
            FROM sim_phase_product_splits
            WHERE phase_id = %s AND lot_type_id = %s
            """,
            (from_phase_id, lot["lot_type_id"]),
        )
        split_row = cur.fetchone()
        projected = int(split_row["lot_count"]) if split_row else 0

        from_phase_counts = {
            "phase_id": from_phase_id,
            "by_lot_type": [
                {
                    "lot_type_id": lot["lot_type_id"],
                    "actual": actual,
                    "projected": projected,
                    "total": max(actual, projected),
                }
            ],
        }

        return ReassignmentResult(
            success=True,
            transaction={
                "action": "lot_phase_unassignment",
                "lot_id": lot_id,
                "lot_number": lot["lot_number"],
                "from_phase_id": from_phase_id,
                "to_phase_id": 0,
            },
            needs_rerun=affected_pg_ids,
            warnings=warnings,
            phase_counts=from_phase_counts,   # reuse phase_counts field to carry from_phase_counts
        )

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
