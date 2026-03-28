# phase_models.py
# Pydantic request/response models for phase endpoints.

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class PhaseUpdateRequest(BaseModel):
    projected_count: Optional[int] = None
    phase_name: Optional[str] = None


class PhaseCreateRequest(BaseModel):
    instrument_id: int
    phase_name: str


class PhaseInstrumentReassignRequest(BaseModel):
    target_instrument_id: int | None
    changed_by: str = "user"


class PhaseInstrumentReassignResponse(BaseModel):
    transaction: dict
    needs_rerun: list[int]
    warnings: list[dict]
