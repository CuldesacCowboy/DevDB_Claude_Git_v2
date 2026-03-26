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
        cur.execute(
            "SELECT phase_id, dev_id, phase_name FROM sim_dev_phases WHERE phase_id = %s",
            (from_phase_id,),
        )
        current_phase = cur.fetchone()

        if target_phase["dev_id"] != current_phase["dev_id"]:
            conn.rollback()
            return _fail(
                "cross_development_move",
                f"Phase {target_phase_id} is in development "
                f"dev {target_phase['dev_id']}. "
                f"Lot {lot['lot_number']} is in development "
                f"dev {current_phase['dev_id']}. "
                "Lots cannot be moved across developments.",
            )

        if from_phase_id == target_phase_id:
            conn.rollback()
            return _fail(
                "already_in_phase",
                f"Lot {lot['lot_number']} is already assigned to phase {target_phase_id}.",
            )

        cur.execute(
            """
            SELECT lot_count
            FROM sim_phase_product_splits
            WHERE phase_id = %s AND lot_type_id = %s
            """,
            (target_phase_id, lot["lot_type_id"]),
        )
        target_split = cur.fetchone()

        if target_split is None or target_split["lot_count"] < 1:
            cur.execute(
                """
                SELECT COUNT(*) AS actual
                FROM sim_lots
                WHERE phase_id = %s AND lot_type_id = %s AND lot_source = 'real'
                """,
                (target_phase_id, lot["lot_type_id"]),
            )
            actual_row = cur.fetchone()
            actual = int(actual_row["actual"]) if actual_row else 0
            projected = int(target_split["lot_count"]) if target_split else 0
            total = actual + projected
            conn.rollback()
            return _fail(
                "projected_would_go_negative",
                f"Phase {target_phase['phase_name']} has no remaining projected capacity "
                f"for lot type {lot['lot_type_id']}. All {total} slots are occupied by "
                "real lots. Increase lot count in Setup Tools before moving additional lots here.",
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
        # Step 3 — Adjust FROM side projected (add back 1)
        # ----------------------------------------------------------------
        cur.execute(
            """
            UPDATE sim_phase_product_splits
            SET lot_count = lot_count + 1
            WHERE phase_id = %s AND lot_type_id = %s
            """,
            (from_phase_id, lot["lot_type_id"]),
        )

        # ----------------------------------------------------------------
        # Step 4 — Adjust TO side projected (subtract 1)
        # ----------------------------------------------------------------
        cur.execute(
            """
            UPDATE sim_phase_product_splits
            SET lot_count = lot_count - 1
            WHERE phase_id = %s AND lot_type_id = %s
            """,
            (target_phase_id, lot["lot_type_id"]),
        )

        # ----------------------------------------------------------------
        # Step 5 — Set needs_rerun
        # ----------------------------------------------------------------
        # Query after lot update so the moved lot (now in target_phase) is included.
        # Covers the edge case where from_phase has no remaining lots:
        # the moved lot's PG is captured via target_phase_id.
        cur.execute(
            """
            SELECT DISTINCT projection_group_id
            FROM sim_lots
            WHERE phase_id = ANY(%s)
            """,
            ([from_phase_id, target_phase_id],),
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
                from_phase_id,
                target_phase_id,
                changed_by,
                psycopg2.extras.Json(metadata),
            ),
        )

        conn.commit()

        # ----------------------------------------------------------------
        # Post-commit: build phase_counts
        # ----------------------------------------------------------------
        def _phase_count(phase_id: int, lot_type_id: int) -> dict:
            cur.execute(
                """
                SELECT COUNT(*) AS actual
                FROM sim_lots
                WHERE phase_id = %s AND lot_type_id = %s AND lot_source = 'real'
                """,
                (phase_id, lot_type_id),
            )
            actual = int(cur.fetchone()["actual"])
            cur.execute(
                """
                SELECT lot_count
                FROM sim_phase_product_splits
                WHERE phase_id = %s AND lot_type_id = %s
                """,
                (phase_id, lot_type_id),
            )
            split_row = cur.fetchone()
            projected = int(split_row["lot_count"]) if split_row else 0
            return {
                "lot_type_id": lot_type_id,
                "actual": actual,
                "projected": projected,
                "total": actual + projected,
            }

        lot_type_id = lot["lot_type_id"]
        phase_counts = {
            "from_phase": {
                "phase_id": from_phase_id,
                "by_lot_type": [_phase_count(from_phase_id, lot_type_id)],
            },
            "to_phase": {
                "phase_id": target_phase_id,
                "by_lot_type": [_phase_count(target_phase_id, lot_type_id)],
            },
        }

        return ReassignmentResult(
            success=True,
            transaction={
                "action": "lot_phase_reassignment",
                "lot_id": lot_id,
                "lot_number": lot["lot_number"],
                "from_phase_id": from_phase_id,
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
