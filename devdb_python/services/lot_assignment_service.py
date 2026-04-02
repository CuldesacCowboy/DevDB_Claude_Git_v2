# lot_assignment_service.py
# Service layer for lot-to-phase reassignment.
# Accepts a raw psycopg2 connection (autocommit=False).
# All six steps execute inside a single transaction; full rollback on any failure.
# Does NOT involve the planning kernel -- this is a data management operation.

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg2.extras


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ReassignmentResult:
    success: bool
    transaction: dict = field(default_factory=dict)
    needs_rerun: list[int] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    phase_counts: dict = field(default_factory=dict)
    error: dict | None = None
    building_group_lot_ids: list[int] = field(default_factory=list)


@dataclass
class LotTypeChangeResult:
    success: bool
    lot_id: int = 0
    phase_id: int = 0
    old_lot_type_id: int = 0
    new_lot_type_id: int = 0
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
    """Insert splits rows for lot_type_ids with actual > 0 but no row; delete rows where actual = 0 AND projected_count = 0."""
    cur.execute(
        """
        INSERT INTO sim_phase_product_splits (phase_id, lot_type_id, projected_count)
        SELECT %s, actual.lot_type_id, 0
        FROM (
            SELECT lot_type_id
            FROM sim_lots
            WHERE phase_id = %s AND lot_source = 'real'
            GROUP BY lot_type_id
            HAVING COUNT(*) > 0
        ) actual
        ON CONFLICT (phase_id, lot_type_id) DO NOTHING
        """,
        (phase_id, phase_id),
    )
    cur.execute(
        """
        DELETE FROM sim_phase_product_splits
        WHERE phase_id = %s
          AND projected_count = 0
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
               sps.projected_count AS projected,
               GREATEST(COALESCE(actual.cnt, 0), sps.projected_count) AS total
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
                   dev_id, date_str, date_cmp, date_cls,
                   building_group_id
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
        # Find building group siblings (same building_group_id, real lots)
        # ----------------------------------------------------------------
        building_group_id = lot["building_group_id"]
        sibling_lots = []
        if building_group_id is not None:
            cur.execute(
                """
                SELECT lot_id, lot_number, lot_type_id, dev_id,
                       phase_id, date_str, date_cmp, date_cls
                FROM sim_lots
                WHERE building_group_id = %s
                  AND lot_source = 'real'
                  AND lot_id != %s
                """,
                (building_group_id, lot_id),
            )
            sibling_lots = list(cur.fetchall())

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
        sibling_has_actual = any(
            (s["date_str"] is not None or s["date_cmp"] is not None) and s["date_cls"] is None
            for s in sibling_lots
        )
        if has_actual_dates or sibling_has_actual:
            lot_ref = lot["lot_number"] if not sibling_lots else f"building group (lot {lot['lot_number']})"
            warnings.append(
                {
                    "code": "actual_dates_present",
                    "message": (
                        f"Lot {lot_ref} is under construction or complete "
                        "with recorded MARKsystems dates. Moving it changes its "
                        "projected delivery context but does not affect its recorded actuals."
                    ),
                }
            )

        # ----------------------------------------------------------------
        # Step 2 — Move primary lot and all building group siblings
        # ----------------------------------------------------------------
        all_lot_ids = [lot_id] + [s["lot_id"] for s in sibling_lots]
        cur.execute(
            "UPDATE sim_lots SET phase_id = %s WHERE lot_id = ANY(%s)",
            (target_phase_id, all_lot_ids),
        )

        # ----------------------------------------------------------------
        # Step 2b — Maintain sim_phase_product_splits for all affected phases
        # ----------------------------------------------------------------
        all_from_phase_ids = {lot["phase_id"]} | {s["phase_id"] for s in sibling_lots}
        all_from_phase_ids.discard(None)
        for pid in all_from_phase_ids | {target_phase_id}:
            _maintain_splits(cur, pid)

        # ----------------------------------------------------------------
        # Step 6 — Audit log (one entry per moved lot)
        # ----------------------------------------------------------------
        def _log_move(lid, lnumber, ltype, from_pid, had_actual):
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
                    lid,
                    from_pid if from_pid is not None else 0,
                    target_phase_id,
                    changed_by,
                    psycopg2.extras.Json({
                        "lot_number": lnumber,
                        "lot_type_id": ltype,
                        "had_actual_dates": had_actual,
                        "building_group_id": building_group_id,
                    }),
                ),
            )

        _log_move(lot_id, lot["lot_number"], lot["lot_type_id"],
                  lot["phase_id"], has_actual_dates)
        for s in sibling_lots:
            sib_actual = (s["date_str"] is not None or s["date_cmp"] is not None) and s["date_cls"] is None
            _log_move(s["lot_id"], s["lot_number"], s["lot_type_id"],
                      s["phase_id"], sib_actual)

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
            needs_rerun=[],
            warnings=warnings,
            phase_counts=phase_counts,
            building_group_lot_ids=all_lot_ids,
        )

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Change lot type
# ---------------------------------------------------------------------------

def change_lot_type(
    conn,
    lot_id: int,
    new_lot_type_id: int,
    changed_by: str,
) -> LotTypeChangeResult:
    """
    Change a real lot's lot_type_id in-place.
    Maintains sim_phase_product_splits for the lot's current phase.
    conn must be a raw psycopg2 connection (not PGConnection wrapper).
    """
    try:
        return _execute_lot_type_change(conn, lot_id, new_lot_type_id, changed_by)
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return LotTypeChangeResult(
            success=False,
            error={"code": "internal_error", "message": str(exc)},
        )


def _execute_lot_type_change(
    conn, lot_id: int, new_lot_type_id: int, changed_by: str
) -> LotTypeChangeResult:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # ----------------------------------------------------------------
        # Step 1 — Validate
        # ----------------------------------------------------------------
        cur.execute(
            """
            SELECT lot_id, phase_id, lot_type_id, lot_source, lot_number
            FROM sim_lots
            WHERE lot_id = %s
            """,
            (lot_id,),
        )
        lot = cur.fetchone()
        if lot is None:
            conn.rollback()
            return LotTypeChangeResult(
                success=False,
                error={"code": "lot_not_found", "message": f"Lot {lot_id} not found."},
            )

        if lot["lot_source"] != "real":
            conn.rollback()
            return LotTypeChangeResult(
                success=False,
                error={
                    "code": "lot_source_not_real",
                    "message": (
                        f"Lot {lot_id} is a sim lot and cannot be manually reclassified. "
                        "Modify simulation parameters to change sim lot types."
                    ),
                },
            )

        old_lot_type_id = lot["lot_type_id"]
        phase_id = lot["phase_id"]

        if old_lot_type_id == new_lot_type_id:
            conn.rollback()
            return LotTypeChangeResult(
                success=False,
                error={
                    "code": "already_this_type",
                    "message": f"Lot {lot['lot_number']} is already lot_type_id {new_lot_type_id}.",
                },
            )

        # Verify target lot type exists
        cur.execute(
            "SELECT lot_type_id FROM ref_lot_types WHERE lot_type_id = %s",
            (new_lot_type_id,),
        )
        if cur.fetchone() is None:
            conn.rollback()
            return LotTypeChangeResult(
                success=False,
                error={
                    "code": "lot_type_not_found",
                    "message": f"lot_type_id {new_lot_type_id} not found in ref_lot_types.",
                },
            )

        # ----------------------------------------------------------------
        # Step 2 — Update lot
        # ----------------------------------------------------------------
        cur.execute(
            "UPDATE sim_lots SET lot_type_id = %s WHERE lot_id = %s",
            (new_lot_type_id, lot_id),
        )

        # ----------------------------------------------------------------
        # Step 3 — Maintain splits (old type may drop to 0; new type may appear)
        # ----------------------------------------------------------------
        if phase_id is not None:
            _maintain_splits(cur, phase_id)

        # ----------------------------------------------------------------
        # Step 4 — Audit log
        # ----------------------------------------------------------------
        cur.execute(
            """
            INSERT INTO sim_assignment_log
                (action, resource_type, resource_id,
                 from_owner_id, to_owner_id,
                 changed_by, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                "lot_type_change",
                "lot",
                lot_id,
                old_lot_type_id,
                new_lot_type_id,
                changed_by,
                psycopg2.extras.Json({
                    "lot_number": lot["lot_number"],
                    "phase_id": phase_id,
                }),
            ),
        )

        conn.commit()

        # ----------------------------------------------------------------
        # Post-commit: build phase counts
        # ----------------------------------------------------------------
        by_lot_type = _build_by_lot_type(cur, phase_id) if phase_id is not None else []

        return LotTypeChangeResult(
            success=True,
            lot_id=lot_id,
            phase_id=phase_id if phase_id is not None else 0,
            old_lot_type_id=old_lot_type_id,
            new_lot_type_id=new_lot_type_id,
            phase_counts={
                "phase": {
                    "phase_id": phase_id if phase_id is not None else 0,
                    "by_lot_type": by_lot_type,
                }
            },
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
                   date_str, date_cmp, date_cls, building_group_id
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
        # Find building group siblings
        # ----------------------------------------------------------------
        building_group_id = lot["building_group_id"]
        sibling_lots = []
        if building_group_id is not None:
            cur.execute(
                """
                SELECT lot_id, lot_number, lot_type_id, dev_id,
                       phase_id, date_str, date_cmp, date_cls
                FROM sim_lots
                WHERE building_group_id = %s
                  AND lot_source = 'real'
                  AND lot_id != %s
                """,
                (building_group_id, lot_id),
            )
            sibling_lots = list(cur.fetchall())

        # ----------------------------------------------------------------
        # Soft warning (UC or C only — same condition as reassignment)
        # ----------------------------------------------------------------
        warnings = []
        has_actual_dates = (
            (lot["date_str"] is not None or lot["date_cmp"] is not None)
            and lot["date_cls"] is None
        )
        sibling_has_actual = any(
            (s["date_str"] is not None or s["date_cmp"] is not None) and s["date_cls"] is None
            for s in sibling_lots
        )
        if has_actual_dates or sibling_has_actual:
            lot_ref = lot["lot_number"] if not sibling_lots else f"building group (lot {lot['lot_number']})"
            warnings.append(
                {
                    "code": "actual_dates_present",
                    "message": (
                        f"Lot {lot_ref} is under construction or complete "
                        "with recorded MARKsystems dates. Moving it changes its "
                        "projected delivery context but does not affect its recorded actuals."
                    ),
                }
            )

        # ----------------------------------------------------------------
        # Step 2 — Unassign primary lot and all siblings
        # ----------------------------------------------------------------
        all_lot_ids = [lot_id] + [s["lot_id"] for s in sibling_lots]
        cur.execute(
            "UPDATE sim_lots SET phase_id = NULL WHERE lot_id = ANY(%s)",
            (all_lot_ids,),
        )

        # ----------------------------------------------------------------
        # Step 3 — Maintain splits for all from_phases
        # ----------------------------------------------------------------
        all_from_phase_ids = {lot["phase_id"]} | {s["phase_id"] for s in sibling_lots if s["phase_id"]}
        for pid in all_from_phase_ids:
            _maintain_splits(cur, pid)

        # ----------------------------------------------------------------
        # Step 5 — Audit log (one entry per unassigned lot)
        # ----------------------------------------------------------------
        def _log_unassign(lid, lnumber, ltype, from_pid, had_actual):
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
                    lid,
                    from_pid,
                    0,
                    changed_by,
                    psycopg2.extras.Json({
                        "lot_number": lnumber,
                        "lot_type_id": ltype,
                        "had_actual_dates": had_actual,
                        "building_group_id": building_group_id,
                    }),
                ),
            )

        _log_unassign(lot_id, lot["lot_number"], lot["lot_type_id"],
                      from_phase_id, has_actual_dates)
        for s in sibling_lots:
            sib_actual = (s["date_str"] is not None or s["date_cmp"] is not None) and s["date_cls"] is None
            _log_unassign(s["lot_id"], s["lot_number"], s["lot_type_id"],
                          s["phase_id"], sib_actual)

        conn.commit()

        # ----------------------------------------------------------------
        # Post-commit: build from_phase_counts (use _build_by_lot_type for completeness)
        # ----------------------------------------------------------------
        from_phase_counts = {
            "phase_id": from_phase_id,
            "by_lot_type": _build_by_lot_type(cur, from_phase_id),
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
            needs_rerun=[],
            warnings=warnings,
            phase_counts=from_phase_counts,
            building_group_lot_ids=all_lot_ids,
        )

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
