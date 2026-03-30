# lot_models.py
# Pydantic request/response models for lot endpoints.

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class LotPhaseReassignRequest(BaseModel):
    target_phase_id: int
    changed_by: str = "user"


class LotTypeCount(BaseModel):
    lot_type_id: int
    lot_type_short: Optional[str] = None
    actual: int
    projected: int
    total: int


class PhaseCountDetail(BaseModel):
    phase_id: int
    by_lot_type: list[LotTypeCount]


class PhaseCounts(BaseModel):
    from_phase: PhaseCountDetail
    to_phase: PhaseCountDetail


class TransactionDetail(BaseModel):
    action: str
    lot_id: int
    lot_number: str | None
    from_phase_id: int
    to_phase_id: int


class Warning(BaseModel):
    code: str
    message: str


class LotPhaseReassignResponse(BaseModel):
    transaction: TransactionDetail
    needs_rerun: list[int]
    warnings: list[Warning]
    phase_counts: PhaseCounts
    building_group_lot_ids: list[int] = []


class LotUnassignResponse(BaseModel):
    transaction: TransactionDetail
    needs_rerun: list[int]
    warnings: list[Warning]
    from_phase_counts: PhaseCountDetail
    building_group_lot_ids: list[int] = []


class LotTypeChangeRequest(BaseModel):
    lot_type_id: int
    changed_by: str = "user"


class LotTypeChangePhaseCounts(BaseModel):
    phase: PhaseCountDetail


class LotTypeChangeResponse(BaseModel):
    lot_id: int
    phase_id: int
    old_lot_type_id: int
    new_lot_type_id: int
    phase_counts: LotTypeChangePhaseCounts


class ErrorResponse(BaseModel):
    error: str
    message: str
    lot_id: int | None = None
    target_phase_id: int | None = None


# ---------------------------------------------------------------------------
# Lot-phase view (read endpoint for spike screen)
# ---------------------------------------------------------------------------

class LotDetail(BaseModel):
    lot_id: int
    lot_number: str | None
    lot_type_id: int
    lot_source: str
    status: str
    has_actual_dates: bool
    building_group_id: int | None = None


class PhaseDetail(BaseModel):
    phase_id: int
    phase_name: str
    sequence_number: int
    dev_id: int = 0
    instrument_id: int | None = None
    by_lot_type: list[LotTypeCount]
    lots: list[LotDetail]


class InstrumentDetail(BaseModel):
    instrument_id: int
    instrument_name: str
    instrument_type: str
    dev_id: int
    dev_name: str
    phases: list[PhaseDetail]


class DevLotPhaseViewResponse(BaseModel):
    dev_id: int
    dev_name: str
    unassigned: list[LotDetail]
    phases: list[PhaseDetail]


class EntGroupLotPhaseViewResponse(BaseModel):
    ent_group_id: int
    ent_group_name: str
    unassigned: list[LotDetail]
    instruments: list[InstrumentDetail]
    unassigned_phases: list[PhaseDetail]
