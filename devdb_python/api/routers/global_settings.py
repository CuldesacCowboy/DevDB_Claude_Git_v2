# routers/global_settings.py
# Global simulation settings — build times, inventory floors, default delivery cadence.
# Single-row table (id=1). Community delivery config overrides where non-null.

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/global-settings", tags=["global-settings"])


class GlobalSettingsPutRequest(BaseModel):
    delivery_months:         list[int] | None = None
    max_deliveries_per_year: int        | None = None
    default_cmp_lag_days:    int        | None = None
    default_cls_lag_days:    int        | None = None
    # Floors may be explicitly null (= no alert)
    min_d_count:  int | None = None
    min_u_count:  int | None = None
    min_uc_count: int | None = None
    min_c_count:  int | None = None


@router.get("")
def get_global_settings(conn=Depends(get_db_conn)):
    """Return the global simulation settings row."""
    cur = dict_cursor(conn)
    try:
        cur.execute("SELECT * FROM sim_global_settings WHERE id = 1")
        return cur.fetchone() or {}
    finally:
        cur.close()


@router.put("")
def put_global_settings(body: GlobalSettingsPutRequest, conn=Depends(get_db_conn)):
    """
    Update global simulation settings.
    Required fields (delivery_months, max_deliveries_per_year, lag days) use COALESCE
    so omitting them preserves existing values.
    Floor fields use direct SET — null means 'no alert'.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            INSERT INTO sim_global_settings
                (id, delivery_months, max_deliveries_per_year,
                 default_cmp_lag_days, default_cls_lag_days,
                 min_d_count, min_u_count, min_uc_count, min_c_count,
                 updated_at)
            VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                delivery_months         = COALESCE(EXCLUDED.delivery_months,         sim_global_settings.delivery_months),
                max_deliveries_per_year = COALESCE(EXCLUDED.max_deliveries_per_year, sim_global_settings.max_deliveries_per_year),
                default_cmp_lag_days    = COALESCE(EXCLUDED.default_cmp_lag_days,    sim_global_settings.default_cmp_lag_days),
                default_cls_lag_days    = COALESCE(EXCLUDED.default_cls_lag_days,    sim_global_settings.default_cls_lag_days),
                min_d_count             = EXCLUDED.min_d_count,
                min_u_count             = EXCLUDED.min_u_count,
                min_uc_count            = EXCLUDED.min_uc_count,
                min_c_count             = EXCLUDED.min_c_count,
                updated_at              = NOW()
            RETURNING *
            """,
            (
                body.delivery_months,
                body.max_deliveries_per_year,
                body.default_cmp_lag_days,
                body.default_cls_lag_days,
                body.min_d_count,
                body.min_u_count,
                body.min_uc_count,
                body.min_c_count,
            ),
        )
        conn.commit()
        return cur.fetchone()
    finally:
        cur.close()
