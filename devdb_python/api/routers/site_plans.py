# routers/site_plans.py
# Site plan upload and serve endpoints.
# One PDF per entitlement group. Upload replaces any existing plan.

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from api.deps import get_db_conn

router = APIRouter(prefix="/site-plans", tags=["site-plans"])

_UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "site_plans"


class SitePlanResponse(BaseModel):
    plan_id: int
    ent_group_id: int
    file_path: str
    page_count: int
    active_page: int


def _row_to_plan(row) -> SitePlanResponse:
    return SitePlanResponse(
        plan_id=row[0],
        ent_group_id=row[1],
        file_path=row[2],
        page_count=row[3],
        active_page=row[4],
    )


@router.post("", response_model=SitePlanResponse)
async def upload_site_plan(
    ent_group_id: int = Query(...),
    file: UploadFile = File(...),
    conn=Depends(get_db_conn),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are accepted")

    _UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT ent_group_id FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Entitlement group not found")

        # Delete any existing plan for this group (one plan per group)
        cur.execute(
            "SELECT plan_id, file_path FROM sim_site_plans WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        existing = cur.fetchone()
        if existing:
            old_path = Path(existing[1])
            old_path.unlink(missing_ok=True)
            cur.execute("DELETE FROM sim_site_plans WHERE ent_group_id = %s", (ent_group_id,))

        dest = _UPLOADS_DIR / f"ent_{ent_group_id}.pdf"
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        cur.execute(
            """
            INSERT INTO sim_site_plans (ent_group_id, file_path, page_count, active_page)
            VALUES (%s, %s, 1, 1)
            RETURNING plan_id, ent_group_id, file_path, page_count, active_page
            """,
            (ent_group_id, str(dest)),
        )
        row = cur.fetchone()
        conn.commit()

    return _row_to_plan(row)


@router.get("/ent-group/{ent_group_id}", response_model=SitePlanResponse)
def get_plan_for_ent_group(ent_group_id: int, conn=Depends(get_db_conn)):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT plan_id, ent_group_id, file_path, page_count, active_page
            FROM sim_site_plans WHERE ent_group_id = %s
            """,
            (ent_group_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No site plan for this entitlement group")
    return _row_to_plan(row)


@router.get("/{plan_id}/file")
def serve_plan_file(plan_id: int, conn=Depends(get_db_conn)):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT file_path FROM sim_site_plans WHERE plan_id = %s", (plan_id,)
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Plan not found")
    path = Path(row[0])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Plan file missing from disk")
    return FileResponse(str(path), media_type="application/pdf")
