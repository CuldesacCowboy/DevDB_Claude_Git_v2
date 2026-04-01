# routers/site_plans.py
# Site plan upload and serve endpoints.
# One PDF per development. Upload replaces any existing plan.

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
    dev_id: int
    file_path: str
    page_count: int
    active_page: int


def _row_to_plan(row) -> SitePlanResponse:
    return SitePlanResponse(
        plan_id=row[0],
        dev_id=row[1],
        file_path=row[2],
        page_count=row[3],
        active_page=row[4],
    )


@router.post("", response_model=SitePlanResponse)
async def upload_site_plan(
    dev_id: int = Query(...),
    file: UploadFile = File(...),
    conn=Depends(get_db_conn),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are accepted")

    _UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    with conn.cursor() as cur:
        cur.execute("SELECT dev_id FROM developments WHERE dev_id = %s", (dev_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Development not found")

        # Delete any existing plan for this dev (one plan per dev)
        cur.execute(
            "SELECT plan_id, file_path FROM sim_site_plans WHERE dev_id = %s", (dev_id,)
        )
        existing = cur.fetchone()
        if existing:
            old_path = Path(existing[1])
            if old_path.exists():
                old_path.unlink(missing_ok=True)
            cur.execute("DELETE FROM sim_site_plans WHERE dev_id = %s", (dev_id,))

        dest = _UPLOADS_DIR / f"dev_{dev_id}.pdf"
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        cur.execute(
            """
            INSERT INTO sim_site_plans (dev_id, file_path, page_count, active_page)
            VALUES (%s, %s, 1, 1)
            RETURNING plan_id, dev_id, file_path, page_count, active_page
            """,
            (dev_id, str(dest)),
        )
        row = cur.fetchone()
        conn.commit()

    return _row_to_plan(row)


@router.get("/dev/{dev_id}", response_model=SitePlanResponse)
def get_plan_for_dev(dev_id: int, conn=Depends(get_db_conn)):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT plan_id, dev_id, file_path, page_count, active_page
            FROM sim_site_plans WHERE dev_id = %s
            """,
            (dev_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No site plan for this development")
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
