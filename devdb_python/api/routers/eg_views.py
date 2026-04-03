# routers/eg_views.py
# Entitlement-group complex views.

from fastapi import APIRouter, Depends

from api.deps import get_db_conn
from api.models.lot_models import EntGroupLotPhaseViewResponse
from services.eg_lot_phase_service import query_lot_phase_view


router = APIRouter(prefix="/entitlement-groups", tags=["entitlement-groups"])


@router.get("/{ent_group_id}/lot-phase-view", response_model=EntGroupLotPhaseViewResponse)
def ent_group_lot_phase_view(ent_group_id: int, conn=Depends(get_db_conn)):
    return query_lot_phase_view(ent_group_id, conn)
