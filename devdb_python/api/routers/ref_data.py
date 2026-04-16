# routers/ref_data.py
# Reference data endpoints for county and school district dropdowns.

from fastapi import APIRouter, Depends

from api.db import dict_cursor
from api.deps import get_db_conn

router = APIRouter(prefix="/ref", tags=["ref"])


@router.get("/counties")
def list_counties(conn=Depends(get_db_conn)):
    """All counties with their state abbreviation, ordered by state then name."""
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT c.county_id, c.county_name, s.state_abbr, s.state_name
            FROM devdb.ref_counties c
            JOIN devdb.ref_states s ON s.state_id = c.state_id
            ORDER BY s.state_abbr, c.county_name
        """)
        return [
            {
                "county_id":   r["county_id"],
                "county_name": r["county_name"],
                "state_abbr":  r["state_abbr"],
                "state_name":  r["state_name"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/school-districts")
def list_school_districts(county_id: int | None = None, conn=Depends(get_db_conn)):
    """
    All school districts, optionally filtered to a single county.
    When county_id is provided, returns districts whose primary county matches
    (plus any null-county districts so they are never hidden from the list).
    """
    cur = dict_cursor(conn)
    try:
        if county_id is not None:
            cur.execute("""
                SELECT sd.sd_id, sd.district_name, sd.sd_code, sd.quality_grade,
                       sd.county_id, c.county_name
                FROM devdb.ref_school_districts sd
                LEFT JOIN devdb.ref_counties c ON c.county_id = sd.county_id
                WHERE sd.county_id = %s OR sd.county_id IS NULL
                ORDER BY sd.district_name
            """, (county_id,))
        else:
            cur.execute("""
                SELECT sd.sd_id, sd.district_name, sd.sd_code, sd.quality_grade,
                       sd.county_id, c.county_name
                FROM devdb.ref_school_districts sd
                LEFT JOIN devdb.ref_counties c ON c.county_id = sd.county_id
                ORDER BY c.county_name NULLS LAST, sd.district_name
            """)
        return [
            {
                "sd_id":         r["sd_id"],
                "district_name": r["district_name"],
                "sd_code":       r["sd_code"].strip() if r["sd_code"] else None,
                "quality_grade": r["quality_grade"].strip() if r["quality_grade"] else None,
                "county_id":     r["county_id"],
                "county_name":   r["county_name"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()
