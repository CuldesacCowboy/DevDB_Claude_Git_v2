# phase_models.py
# Pydantic request/response models for phase endpoints.

from __future__ import annotations

from pydantic import BaseModel


class PhaseInstrumentReassignRequest(BaseModel):
    target_instrument_id: int | None
    changed_by: str = "user"


class PhaseInstrumentReassignResponse(BaseModel):
    transaction: dict
    needs_rerun: list[int]
    warnings: list[dict]
