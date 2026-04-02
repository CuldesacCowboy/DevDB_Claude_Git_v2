# phase_assignment_service.py
# Service layer for phase-to-instrument reassignment.
# Accepts a raw psycopg2 connection (autocommit=False).
# All steps execute inside a single transaction; full rollback on any failure.

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg2.extras


@dataclass
class PhaseAssignResult:
    success: bool
    transaction: dict = field(default_factory=dict)
    needs_rerun: list[int] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    error: dict | None = None


def _fail(code: str, message: str) -> PhaseAssignResult:
    return PhaseAssignResult(success=False, error={"code": code, "message": message})


def reassign_phase_to_instrument(
    conn,
    phase_id: int,
    target_instrument_id: int | None,
    changed_by: str,
) -> PhaseAssignResult:
    """
    Assign or unassign a phase to/from a legal instrument.
    target_instrument_id = None removes the instrument assignment.
    """
    try:
        return _execute(conn, phase_id, target_instrument_id, changed_by)
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return PhaseAssignResult(
            success=False,
            error={"code": "internal_error", "message": str(exc)},
        )


def _execute(conn, phase_id: int, target_instrument_id: int | None, changed_by: str) -> PhaseAssignResult:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # ----------------------------------------------------------------
        # Step 1 — Validate
        # ----------------------------------------------------------------
        cur.execute(
            """
            SELECT phase_id, phase_name, dev_id, instrument_id
            FROM sim_dev_phases
            WHERE phase_id = %s
            """,
            (phase_id,),
        )
        phase = cur.fetchone()
        if phase is None:
            conn.rollback()
            return _fail("phase_not_found", f"Phase {phase_id} not found.")

        from_instrument_id = phase["instrument_id"]

        if from_instrument_id == target_instrument_id:
            conn.rollback()
            return _fail(
                "already_assigned",
                f"Phase {phase['phase_name']} is already assigned to that instrument.",
            )

        if target_instrument_id is not None:
            cur.execute(
                """
                SELECT instrument_id, dev_id
                FROM sim_legal_instruments
                WHERE instrument_id = %s
                """,
                (target_instrument_id,),
            )
            instrument = cur.fetchone()
            if instrument is None:
                conn.rollback()
                return _fail(
                    "instrument_not_found",
                    f"Instrument {target_instrument_id} not found.",
                )

            # Verify both phase and instrument are in the same entitlement group
            check_dev_ids = list({phase["dev_id"], instrument["dev_id"]})
            cur.execute(
                """
                SELECT dev_id, ent_group_id
                FROM sim_ent_group_developments
                WHERE dev_id = ANY(%s)
                """,
                (check_dev_ids,),
            )
            ent_map = {r["dev_id"]: r["ent_group_id"] for r in cur.fetchall()}
            phase_ent = ent_map.get(phase["dev_id"])
            instr_ent = ent_map.get(instrument["dev_id"])

            if phase_ent is None or phase_ent != instr_ent:
                conn.rollback()
                return _fail(
                    "cross_entitlement_group_move",
                    f"Instrument {target_instrument_id} is not in the same "
                    f"entitlement group as phase {phase_id}.",
                )

        # ----------------------------------------------------------------
        # Step 2 — Update phase
        # ----------------------------------------------------------------
        cur.execute(
            "UPDATE sim_dev_phases SET instrument_id = %s WHERE phase_id = %s",
            (target_instrument_id, phase_id),
        )

        # ----------------------------------------------------------------
        # Step 4 — Audit log
        # ----------------------------------------------------------------
        action = (
            "phase_instrument_unassignment"
            if target_instrument_id is None
            else "phase_instrument_reassignment"
        )
        metadata = {
            "phase_name": phase["phase_name"],
            "dev_id": phase["dev_id"],
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
                action,
                "phase",
                phase_id,
                from_instrument_id if from_instrument_id is not None else 0,
                target_instrument_id if target_instrument_id is not None else 0,
                changed_by,
                psycopg2.extras.Json(metadata),
            ),
        )

        conn.commit()

        return PhaseAssignResult(
            success=True,
            transaction={
                "action": action,
                "phase_id": phase_id,
                "phase_name": phase["phase_name"],
                "from_instrument_id": from_instrument_id if from_instrument_id is not None else 0,
                "to_instrument_id": target_instrument_id if target_instrument_id is not None else 0,
            },
            needs_rerun=[],
        )

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
