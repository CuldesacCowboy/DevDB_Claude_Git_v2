# routers/bulk_lots.py
# Bulk pre-MARKS lot creation: suggest lot numbers and insert as lot_source='pre'.
# 'pre' lots are real lots that exist in DevDB before MARKsystems records them.
# They are treated identically to 'real' lots for assignment and simulation purposes.

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/bulk-lots", tags=["bulk-lots"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_phase_dev(cur, phase_id: int) -> dict:
    """Return {dev_id, dev_code} for a phase, or raise 404."""
    cur.execute(
        """
        SELECT sdp.dev_id, dd.dev_code2 AS dev_code
        FROM sim_dev_phases sdp
        JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
        JOIN dim_development dd ON dd.development_id = sdp.dev_id
        WHERE sdp.phase_id = %s
        """,
        (phase_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Phase {phase_id} not found.")
    return row


def _lot_number_parts(lot_number: str):
    """Parse a lot_number like 'WS043' into ('WS', 43). Returns None if no match."""
    m = re.match(r'^([A-Za-z]+)(\d+)$', lot_number.strip())
    if not m:
        return None
    return m.group(1).upper(), int(m.group(2))


def _infer_pattern(cur, dev_id: int, dev_code: str):
    """
    Infer lot number prefix, max sequence, and zero-pad width from existing lots.
    Falls back to dev_code prefix, seq=0, pad=3 when no lots exist.
    """
    cur.execute(
        "SELECT lot_number FROM sim_lots WHERE dev_id = %s AND lot_number IS NOT NULL",
        (dev_id,),
    )
    rows = cur.fetchall()

    prefix = dev_code.upper() if dev_code else ""
    max_seq = 0
    pad_width = 3

    for r in rows:
        parts = _lot_number_parts(r["lot_number"])
        if parts is None:
            continue
        p, seq = parts
        # Prefer prefix that matches dev_code; fall back to any parsed prefix
        if not prefix or p.upper() == dev_code.upper():
            prefix = p.upper()
        max_seq = max(max_seq, seq)
        # Infer pad width from existing lot number digit count
        digit_count = len(r["lot_number"]) - len(p)
        pad_width = max(pad_width, digit_count)

    # If we found lots but none matched dev_code, just use whatever prefix we found
    if not prefix and rows:
        for r in rows:
            parts = _lot_number_parts(r["lot_number"])
            if parts:
                prefix = parts[0].upper()
                break

    return prefix, max_seq, pad_width


def _format_lot_number(prefix: str, seq: int, pad_width: int) -> str:
    return f"{prefix}{str(seq).zfill(pad_width)}"


def _maintain_splits(cur, phase_id: int) -> None:
    """Insert missing split rows; delete zero-rows with no actual lots."""
    cur.execute(
        """
        INSERT INTO sim_phase_product_splits (phase_id, lot_type_id, projected_count)
        SELECT %s, actual.lot_type_id, 0
        FROM (
            SELECT lot_type_id
            FROM sim_lots
            WHERE phase_id = %s AND lot_source IN ('real', 'pre')
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
              WHERE sl.phase_id = %s
                AND sl.lot_type_id = sim_phase_product_splits.lot_type_id
                AND sl.lot_source IN ('real', 'pre')
          )
        """,
        (phase_id, phase_id),
    )


# ─── Suggestions endpoint ─────────────────────────────────────────────────────

class LotTypeRequest(BaseModel):
    lot_type_id: int
    count: int


class SuggestionsRequest(BaseModel):
    phase_id: int
    requests: list[LotTypeRequest]


@router.post("/suggestions")
def get_suggestions(body: SuggestionsRequest, conn=Depends(get_db_conn)):
    """
    Suggest lot numbers for a bulk insert.
    Returns a flat ordered list of {lot_number, lot_type_id, lot_type_short}
    with sequential numbering starting from next available seq for the dev.
    Also returns prefix, next_seq, pad_width for the frontend range editor.
    """
    if not body.requests:
        return {"prefix": "", "next_seq": 1, "pad_width": 3, "suggestions": []}

    total = sum(r.count for r in body.requests)
    if total <= 0:
        return {"prefix": "", "next_seq": 1, "pad_width": 3, "suggestions": []}

    cur = dict_cursor(conn)
    try:
        phase_dev = _get_phase_dev(cur, body.phase_id)
        dev_id = phase_dev["dev_id"]
        dev_code = phase_dev["dev_code"] or ""

        # Lot type short names
        lot_type_ids = [r.lot_type_id for r in body.requests]
        cur.execute(
            "SELECT lot_type_id, lot_type_short FROM ref_lot_types WHERE lot_type_id = ANY(%s)",
            (lot_type_ids,),
        )
        lt_shorts = {r["lot_type_id"]: r["lot_type_short"] for r in cur.fetchall()}

        prefix, max_seq, pad_width = _infer_pattern(cur, dev_id, dev_code)
        next_seq = max_seq + 1

        # Build flat suggestion list: each lot type gets a contiguous block
        suggestions = []
        seq = next_seq
        for req in body.requests:
            for _ in range(req.count):
                suggestions.append({
                    "lot_number": _format_lot_number(prefix, seq, pad_width),
                    "lot_type_id": req.lot_type_id,
                    "lot_type_short": lt_shorts.get(req.lot_type_id, str(req.lot_type_id)),
                })
                seq += 1

        return {
            "prefix": prefix,
            "next_seq": next_seq,
            "pad_width": pad_width,
            "suggestions": suggestions,
        }
    finally:
        cur.close()


# ─── Insert endpoint ──────────────────────────────────────────────────────────

class LotInsertRow(BaseModel):
    lot_number: str
    lot_type_id: int
    phase_id: int


class BulkInsertRequest(BaseModel):
    lots: list[LotInsertRow]


@router.post("/insert")
def bulk_insert(body: BulkInsertRequest, conn=Depends(get_db_conn)):
    """
    Insert pre-MARKS lots (lot_source='pre').
    All lots in the request are inserted in a single transaction.
    Returns list of inserted {lot_id, lot_number, lot_type_id, phase_id}.
    """
    if not body.lots:
        return {"inserted": []}

    cur = dict_cursor(conn)
    try:
        now = datetime.now(timezone.utc)

        # Validate all phases exist and collect dev_ids
        phase_ids = list({lot.phase_id for lot in body.lots})
        cur.execute(
            """
            SELECT sdp.phase_id, sdp.dev_id
            FROM sim_dev_phases sdp
            WHERE sdp.phase_id = ANY(%s)
            """,
            (phase_ids,),
        )
        phase_dev_map = {r["phase_id"]: r["dev_id"] for r in cur.fetchall()}
        missing = [pid for pid in phase_ids if pid not in phase_dev_map]
        if missing:
            raise HTTPException(status_code=404, detail=f"Phases not found: {missing}")

        # Check for duplicate lot_numbers within request
        lot_numbers = [lot.lot_number.strip() for lot in body.lots]
        if len(lot_numbers) != len(set(lot_numbers)):
            raise HTTPException(status_code=422, detail="Duplicate lot numbers in request.")

        # Check for conflicts with existing lot_numbers in the same dev(s)
        dev_ids = list(set(phase_dev_map.values()))
        cur.execute(
            "SELECT lot_number FROM sim_lots WHERE dev_id = ANY(%s) AND lot_number = ANY(%s)",
            (dev_ids, lot_numbers),
        )
        conflicts = [r["lot_number"] for r in cur.fetchall()]
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail=f"Lot numbers already exist: {conflicts}",
            )

        # Insert lots
        inserted = []
        affected_phases = set()
        for lot in body.lots:
            dev_id = phase_dev_map[lot.phase_id]
            cur.execute(
                """
                INSERT INTO sim_lots
                    (dev_id, phase_id, lot_source, lot_number, lot_type_id,
                     created_at, updated_at)
                VALUES (%s, %s, 'pre', %s, %s, %s, %s)
                RETURNING lot_id
                """,
                (dev_id, lot.phase_id, lot.lot_number.strip(), lot.lot_type_id, now, now),
            )
            lot_id = cur.fetchone()["lot_id"]
            inserted.append({
                "lot_id": lot_id,
                "lot_number": lot.lot_number.strip(),
                "lot_type_id": lot.lot_type_id,
                "phase_id": lot.phase_id,
            })
            affected_phases.add(lot.phase_id)

            # Audit log
            cur.execute(
                """
                INSERT INTO sim_assignment_log
                    (action, resource_type, resource_id,
                     from_owner_id, to_owner_id, changed_by, metadata)
                VALUES ('pre_lot_created', 'lot', %s, 0, %s, 'bulk_insert',
                        '{"lot_source": "pre"}'::jsonb)
                """,
                (lot_id, lot.phase_id),
            )

        # Maintain product splits for all affected phases
        for pid in affected_phases:
            _maintain_splits(cur, pid)

        conn.commit()
        return {"inserted": inserted}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        cur.close()
