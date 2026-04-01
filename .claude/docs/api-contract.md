# DevDB API Contract -- FastAPI Routers

All routers mount under no global prefix (main.py uses bare app.include_router).
Each router declares its own prefix. Route = router prefix + endpoint path.

Note on schema prefix: most queries use bare table names relying on search_path=devdb
set in get_db_conn. The DELETE /phases/{phase_id}/lot-type endpoint explicitly uses
the devdb. prefix. Both work; bare names are the convention everywhere else.

---

### /phases -- phases.py

#### GET /phases/lot-types
- Tables: ref_lot_types
- Guards: none
- Returns: [{lot_type_id: int, lot_type_short: str}]

#### POST /phases
- Tables: sim_legal_instruments (read), sim_dev_phases (read MAX, INSERT)
- Guards: 422 if phase_name empty; 404 if instrument_id not found
- Returns: {phase_id: int, phase_name: str, sequence_number: int, dev_id: int, instrument_id: int}

#### PATCH /phases/{phase_id}/instrument
- Tables: delegated to phase_assignment_service (not visible in router)
- Guards: 422 if service returns not success
- Returns: {transaction: dict, needs_rerun: list[int], warnings: list[dict]}

#### DELETE /phases/{phase_id}
- Tables: sim_dev_phases, sim_lots, sim_phase_product_splits, sim_phase_builder_splits, sim_delivery_event_phases
- Guards: 404 if phase not found
- Returns: {success: bool, phase_id: int, lots_unassigned: int}

#### PATCH /phases/{phase_id}
Two modes dispatched by which field is present in body.

Name mode (body.phase_name provided):
- Tables: sim_dev_phases
- Guards: 422 if phase_name empty; 404 if phase not found (rowcount == 0)
- Returns: {success: bool, phase_id: int, phase_name: str}

Count mode (body.projected_count provided):
- Tables: sim_phase_product_splits
- Guards: 422 if neither field provided; 404 if no splits found for phase
- Returns: {success: bool, projected_count: int}

#### DELETE /phases/{phase_id}/lot-type/{lot_type_id} -- 204
- Tables: devdb.sim_phase_product_splits, devdb.sim_lots
- Guards:
  - 404 if no row in devdb.sim_phase_product_splits for (phase_id, lot_type_id)
  - 400 if projected_count != 0
  - 400 if COUNT of lot_source='real' rows in devdb.sim_lots > 0
- Returns: 204 No Content

#### PATCH /phases/{phase_id}/lot-type/{lot_type_id}/projected
- Tables: sim_phase_product_splits (SELECT/UPDATE/INSERT), sim_lots (aggregate SELECT)
- Guards: 422 if projected_count missing; 422 if projected_count < 0
- Behavior: upserts the split row (INSERT if not exists, UPDATE if exists)
- Returns: {phase_id: int, lot_type_id: int, projected_count: int, actual: int, total: int}
  - actual = COUNT of lot_source='real' rows in sim_lots for this phase+lot_type
  - total = GREATEST(projected_count, actual)

---

### /instruments -- instruments.py

#### POST /instruments
- Tables: developments (read), dim_development (bridge read), sim_legal_instruments (read MAX, INSERT)
- Guards:
  - 422 if instrument_name empty
  - 422 if instrument_type not in {Plat, Site Condo, Other}
  - 422 if dev_id has no marks_code (cannot bridge to legacy dev_id)
- Returns: {instrument_id: int, instrument_name: str, instrument_type: str, dev_id: int}
  - dev_id in response is the legacy dim_development.development_id, not the input developments.dev_id

#### PATCH /instruments/{instrument_id}
- Tables: sim_legal_instruments
- Guards: 422 if name empty; 404 if instrument not found (rowcount == 0)
- Returns: {instrument_id: int, instrument_name: str}

---

### /developments -- developments.py

All read/write operations share this response shape (via _row_to_dict):
{dev_id: int, dev_name: str, marks_code: str|null, in_marks: bool, county_id: int|null,
 county_name: str|null, state_id: int|null, municipality_id: int|null,
 community_id: int|null, community_name: str|null}

#### GET /developments
- Tables: developments, dim_county (LEFT JOIN), sim_entitlement_groups (LEFT JOIN for community_name)
- Guards: none
- Returns: list of development objects (shape above)

#### POST /developments
- Tables: developments (INSERT RETURNING), dim_county, sim_entitlement_groups (re-read for response)
- Guards: 422 if dev_name empty
- Returns: single development object (shape above)

#### GET /developments/{dev_id}
- Tables: developments, dim_county, sim_entitlement_groups
- Guards: 404 if dev_id not found
- Returns: single development object (shape above)

#### PATCH /developments/{dev_id}
- Updatable fields: dev_name, marks_code, in_marks, county_id, state_id, municipality_id,
  community_id (explicit null honoured via model_fields_set)
- Tables: developments (UPDATE), dim_county, sim_entitlement_groups (re-read for response)
- Guards: 422 if no fields provided; 422 if dev_name empty; 404 if not found (rowcount == 0)
- Returns: single development object (shape above, reflects updated values)

#### GET /developments/{dev_id}/lot-phase-view
- Tables: sim_dev_phases, sim_lots, dim_projection_groups, sim_phase_product_splits, ref_lot_types
- Guards: 404 if no phases found for dev_id
- Returns: DevLotPhaseViewResponse
  {dev_id: int, dev_name: str, unassigned: LotDetail[], phases: PhaseDetail[]}
  LotDetail: {lot_id: int, lot_number: str|null, lot_type_id: int, lot_source: str, status: str, has_actual_dates: bool}
  PhaseDetail: {phase_id: int, phase_name: str, sequence_number: int, dev_id: int,
                instrument_id: int|null, by_lot_type: LotTypeCount[], lots: LotDetail[]}
  LotTypeCount: {lot_type_id: int, lot_type_short: str|null, actual: int, projected: int, total: int}
  dev_name is hardcoded as "dev {dev_id}" -- not read from DB in this endpoint

---

### /entitlement-groups -- entitlement_groups.py

#### GET /entitlement-groups
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments,
          sim_dev_phases, sim_lots, sim_phase_product_splits
- Guards: none
- Returns: [{ent_group_id: int, ent_group_name: str, real_count: int,
             projected_count: int, total_count: int}]
  - real_count = COUNT of lot_source='real' lots linked via community_id bridge
  - projected_count = SUM of sim_phase_product_splits.projected_count
  - total_count = SUM of GREATEST(real_count, projected_count) per phase

#### POST /entitlement-groups
- Tables: sim_entitlement_groups
- Guards: 422 if ent_group_name empty
- Returns: {ent_group_id: int, ent_group_name: str}

#### PATCH /entitlement-groups/{ent_group_id}
- Tables: sim_entitlement_groups
- Guards: 422 if ent_group_name empty; 404 if not found (rowcount == 0)
- Returns: {ent_group_id: int, ent_group_name: str}

#### GET /entitlement-groups/{ent_group_id}/lot-phase-view
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments,
          sim_dev_phases, sim_lots, dim_projection_groups, ref_lot_types, sim_phase_product_splits
- Guards: 404 if ent_group not found
- Returns: EntGroupLotPhaseViewResponse
  {ent_group_id: int, ent_group_name: str, unassigned: LotDetail[],
   instruments: InstrumentDetail[], unassigned_phases: PhaseDetail[]}
  InstrumentDetail: {instrument_id: int, instrument_name: str, instrument_type: str,
                     dev_id: int, dev_name: str, phases: PhaseDetail[]}
  PhaseDetail (this endpoint only): includes display_order: int|null in addition to base fields
  Phases within each instrument are sorted: display_order ascending first,
  then auto-sorted by "ph. N" suffix pattern for null display_order entries.
  unassigned_phases = phases where instrument_id IS NULL

---

### /lots -- lots.py

All three endpoints delegate entirely to service functions in lot_assignment_service.
Table access is inside the services, not visible in the router.
Guards are driven by result.success from the service.

Shared sub-types (defined in api/models/lot_models.py):
- TransactionDetail: {action: str, lot_id: int, lot_number: str|null, from_phase_id: int, to_phase_id: int}
- Warning: {code: str, message: str}
- PhaseCountDetail: {phase_id: int, by_lot_type: LotTypeCount[]}
- LotTypeCount: {lot_type_id: int, lot_type_short: str|null, actual: int, projected: int, total: int}

#### PATCH /lots/{lot_id}/phase
- Service: lot_assignment_service.reassign_lot_to_phase
- Guards: 422 if not result.success
- Returns: {transaction: TransactionDetail, needs_rerun: int[], warnings: Warning[],
            phase_counts: {from_phase: PhaseCountDetail, to_phase: PhaseCountDetail}}

#### PATCH /lots/{lot_id}/lot-type
- Service: lot_assignment_service.change_lot_type
- Guards: 422 if not result.success
- Returns: {lot_id: int, phase_id: int, old_lot_type_id: int, new_lot_type_id: int,
            phase_counts: {phase: PhaseCountDetail}}

#### DELETE /lots/{lot_id}/phase
- Service: lot_assignment_service.unassign_lot_from_phase
- Guards: 422 if not result.success
- Returns: {transaction: TransactionDetail, needs_rerun: int[], warnings: Warning[],
            from_phase_counts: PhaseCountDetail}


---

### /takedown-agreements -- takedown_agreements.py

- Owns: TDA read and write endpoints (Slice A + Slice B); agreement list, checkpoint detail,
  lot assignment, HC/BLDR/DIG projected date editing; PATCH rename endpoint;
  sequence-based assignment_id (no MAX+1 race)
- Tables: sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_lot_assignments,
  sim_lots, sim_entitlement_groups
- Projected/locked date fields now live on sim_lots (migration 012, D-152):
  date_td_hold_projected / date_td_hold_is_locked (HC)
  date_td_projected / date_td_is_locked (BLDR)
  date_str_projected / date_str_is_locked (DIG)
- MARKS date sources: HC = date_td_hold, BLDR = date_td, DIG = date_str
- Building-group fan-out: writes to sim_lots WHERE building_group_id matches
  AND lot_id IN (SELECT lot_id FROM sim_takedown_agreement_lots WHERE tda_id = %s)
