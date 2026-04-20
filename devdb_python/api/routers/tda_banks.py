# routers/tda_banks.py
# CRUD for TDA lot banks: phase-scoped eligible lot pools shared across TDAs.

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(tags=["takedown-agreements"])


class CreateBankRequest(BaseModel):
    bank_name: str
    ent_group_id: int
    notes: Optional[str] = None


class PatchBankRequest(BaseModel):
    bank_name: Optional[str] = None
    notes: Optional[str] = None


# ── List banks for a community ─────────────────────────────────────────────

@router.get("/entitlement-groups/{ent_group_id}/tda-lot-banks")
def list_lot_banks(ent_group_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")

        cur.execute(
            """
            SELECT
                b.bank_id,
                b.bank_name,
                b.notes,
                COUNT(DISTINCT m.lot_id)  AS lot_count,
                COUNT(DISTINCT tal.lot_id) AS committed_count,
                ARRAY_AGG(DISTINCT tda.tda_name ORDER BY tda.tda_name)
                    FILTER (WHERE tda.tda_id IS NOT NULL) AS linked_tda_names
            FROM devdb.sim_tda_lot_banks b
            LEFT JOIN devdb.sim_tda_lot_bank_members m ON m.bank_id = b.bank_id
            LEFT JOIN devdb.sim_takedown_agreements tda ON tda.bank_id = b.bank_id
            LEFT JOIN devdb.sim_takedown_agreement_lots tal
                ON tal.tda_id = tda.tda_id
            WHERE b.ent_group_id = %s
            GROUP BY b.bank_id, b.bank_name, b.notes
            ORDER BY b.bank_id
            """,
            (ent_group_id,),
        )
        banks = [
            {
                "bank_id": r["bank_id"],
                "bank_name": r["bank_name"],
                "notes": r["notes"],
                "lot_count": int(r["lot_count"] or 0),
                "committed_count": int(r["committed_count"] or 0),
                "linked_tda_names": r["linked_tda_names"] or [],
            }
            for r in cur.fetchall()
        ]
        return {"ent_group_id": ent_group_id, "banks": banks}
    finally:
        cur.close()


# ── Get available lots for a bank ──────────────────────────────────────────

@router.get("/tda-lot-banks/{bank_id}/available-lots")
def get_bank_available_lots(bank_id: int, conn=Depends(get_db_conn)):
    """Lots in the bank not yet committed to any TDA that references this bank."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT bank_id FROM devdb.sim_tda_lot_banks WHERE bank_id = %s",
            (bank_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Bank {bank_id} not found.")

        cur.execute(
            """
            SELECT l.lot_id, l.lot_number, l.building_group_id
            FROM devdb.sim_tda_lot_bank_members m
            JOIN devdb.sim_lots l ON l.lot_id = m.lot_id
            WHERE m.bank_id = %s
              AND l.lot_id NOT IN (
                  SELECT tal.lot_id
                  FROM devdb.sim_takedown_agreement_lots tal
                  JOIN devdb.sim_takedown_agreements tda ON tda.tda_id = tal.tda_id
                  WHERE tda.bank_id = %s
              )
            ORDER BY l.lot_number
            """,
            (bank_id, bank_id),
        )
        return [
            {
                "lot_id": r["lot_id"],
                "lot_number": r["lot_number"],
                "building_group_id": r["building_group_id"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


# ── Non-members: community real lots not yet in this bank ─────────────────

@router.get("/tda-lot-banks/{bank_id}/non-members")
def get_bank_non_members(bank_id: int, conn=Depends(get_db_conn)):
    """Community real lots not yet in this bank — eligible to be added."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_tda_lot_banks WHERE bank_id = %s",
            (bank_id,),
        )
        bank = cur.fetchone()
        if bank is None:
            raise HTTPException(status_code=404, detail=f"Bank {bank_id} not found.")

        cur.execute(
            """
            SELECT DISTINCT l.lot_id, l.lot_number
            FROM devdb.sim_lots l
            JOIN devdb.sim_dev_phases p ON p.phase_id = l.phase_id
            JOIN devdb.developments d ON d.dev_id = p.dev_id
            WHERE d.community_id = %s
              AND l.lot_source = 'real'
              AND l.lot_id NOT IN (
                  SELECT lot_id FROM devdb.sim_tda_lot_bank_members WHERE bank_id = %s
              )
            ORDER BY l.lot_number
            """,
            (bank["ent_group_id"], bank_id),
        )
        return [{"lot_id": r["lot_id"], "lot_number": r["lot_number"]} for r in cur.fetchall()]
    finally:
        cur.close()


# ── Create bank ────────────────────────────────────────────────────────────

@router.post("/tda-lot-banks")
def create_bank(body: CreateBankRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        if not body.bank_name or not body.bank_name.strip():
            raise HTTPException(status_code=422, detail="bank_name must not be empty.")

        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (body.ent_group_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {body.ent_group_id} not found.")

        cur.execute(
            """
            INSERT INTO devdb.sim_tda_lot_banks (ent_group_id, bank_name, notes, created_at, updated_at)
            VALUES (%s, %s, %s, now(), now())
            RETURNING bank_id, bank_name, notes
            """,
            (body.ent_group_id, body.bank_name.strip(), body.notes),
        )
        row = cur.fetchone()
        conn.commit()
        return {"bank_id": row["bank_id"], "bank_name": row["bank_name"], "notes": row["notes"]}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ── Patch bank ─────────────────────────────────────────────────────────────

@router.patch("/tda-lot-banks/{bank_id}")
def patch_bank(bank_id: int, body: PatchBankRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        updates, values = [], []
        if body.bank_name is not None:
            name = body.bank_name.strip()
            if not name:
                raise HTTPException(status_code=422, detail="bank_name cannot be empty.")
            updates.append("bank_name = %s"); values.append(name)
        if "notes" in body.model_fields_set:
            updates.append("notes = %s"); values.append(body.notes)
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update.")
        updates.append("updated_at = now()")
        values.append(bank_id)
        cur.execute(
            f"UPDATE devdb.sim_tda_lot_banks SET {', '.join(updates)} WHERE bank_id = %s"
            " RETURNING bank_id, bank_name, notes",
            values,
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Bank {bank_id} not found.")
        conn.commit()
        return {"bank_id": row["bank_id"], "bank_name": row["bank_name"], "notes": row["notes"]}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ── Delete bank ────────────────────────────────────────────────────────────

@router.delete("/tda-lot-banks/{bank_id}", status_code=204)
def delete_bank(bank_id: int, conn=Depends(get_db_conn)):
    """Delete only if no TDAs reference this bank."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT COUNT(*) AS n FROM devdb.sim_takedown_agreements WHERE bank_id = %s",
            (bank_id,),
        )
        if int(cur.fetchone()["n"]) > 0:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete bank: one or more agreements reference it. Unlink them first.",
            )
        cur.execute("DELETE FROM devdb.sim_tda_lot_bank_members WHERE bank_id = %s", (bank_id,))
        cur.execute("DELETE FROM devdb.sim_tda_lot_banks WHERE bank_id = %s", (bank_id,))
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ── Add lot to bank ────────────────────────────────────────────────────────

@router.post("/tda-lot-banks/{bank_id}/lots/{lot_id}", status_code=201)
def add_lot_to_bank(bank_id: int, lot_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_tda_lot_banks WHERE bank_id = %s", (bank_id,)
        )
        bank = cur.fetchone()
        if bank is None:
            raise HTTPException(status_code=404, detail=f"Bank {bank_id} not found.")

        cur.execute("SELECT lot_id FROM devdb.sim_lots WHERE lot_id = %s", (lot_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found.")

        cur.execute(
            "INSERT INTO devdb.sim_tda_lot_bank_members (bank_id, lot_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (bank_id, lot_id),
        )
        conn.commit()
        return {"bank_id": bank_id, "lot_id": lot_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ── Remove lot from bank ───────────────────────────────────────────────────

@router.delete("/tda-lot-banks/{bank_id}/lots/{lot_id}", status_code=204)
def remove_lot_from_bank(bank_id: int, lot_id: int, conn=Depends(get_db_conn)):
    """Blocked if the lot is already committed to any TDA that references this bank."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM devdb.sim_takedown_agreement_lots tal
            JOIN devdb.sim_takedown_agreements tda ON tda.tda_id = tal.tda_id
            WHERE tda.bank_id = %s AND tal.lot_id = %s
            """,
            (bank_id, lot_id),
        )
        if int(cur.fetchone()["n"]) > 0:
            raise HTTPException(
                status_code=409,
                detail="Cannot remove lot from bank: it is already committed to a TDA that uses this bank.",
            )
        cur.execute(
            "DELETE FROM devdb.sim_tda_lot_bank_members WHERE bank_id = %s AND lot_id = %s",
            (bank_id, lot_id),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
