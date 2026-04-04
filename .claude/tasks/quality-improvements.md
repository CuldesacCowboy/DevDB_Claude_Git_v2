# DevDB Quality Improvements
*Generated: 2026-04-04*

## CRITICAL

- [x] **1. Add sequences to `sim_lots.lot_id` and `sim_lot_date_violations.violation_id`** ✓ 2026-04-04
  - migration 028 created; s1100 and coordinator updated to omit PK from insert dict

- [x] **2. Add sequences to `sim_delivery_events.delivery_event_id` and `sim_delivery_event_phases.id`** ✓ 2026-04-04
  - Included in migration 028; p0000 uses nextval() instead of MAX+1

## HIGH

- [ ] **3. Replace f-string SQL with parameterized queries in engine**
  - File: `engine/coordinator.py` (15+ locations) and other engine modules
  - Use `%s` substitution throughout

- [ ] **4. Remove `conn._conn` direct access in coordinator**
  - File: `engine/coordinator.py:256-269` (`_write_real_lot_projections`)
  - Add `execute_values()` method to `PGConnection`

- [x] **5. Wrap each migration in an explicit transaction (rollback on failure)** ✓ 2026-04-04
  - api/main.py: autocommit=False; commit after schema_migrations INSERT; rollback+raise on failure

## MEDIUM

- [x] **6. Replace `datetime.utcnow()` with `datetime.now(timezone.utc)`** ✓ 2026-04-04
  - coordinator.py: import timezone added, utcnow() replaced

- [x] **7. Apply `API_BASE` from `config.js` to all 8 remaining frontend files** ✓ 2026-04-04
  - PdfCanvas.jsx, PhaseColumn.jsx, LotPhaseView.jsx, useLotPhaseData.js,
    useDragHandler.js, InstrumentContainer.jsx, CommunityDevelopmentsView.jsx updated
  - useApiMutation.js takes URL as param from callers — no change needed

- [ ] **8. Add timeout to `POST /simulations/run`**
  - File: `api/routers/simulations.py`
  - Add timeout_seconds param to coordinator; raise HTTPException 504 if exceeded

- [ ] **9. Fix `MAX(sequence_number)` race in phase creation**
  - File: `api/routers/phases.py:97`
  - Use atomic CTE or SELECT FOR UPDATE

- [x] **10. Update file-manifest-migrations.md — add missing migrations 013-019 and 022** ✓ 2026-04-04
  - Added 013-019, 022, and 028 to file-manifest-migrations.md

## LOW / CODE QUALITY

- [ ] **11. Replace `print()` with `logging` throughout engine**
  - All engine modules; use `logging.getLogger("devdb.engine")`

- [x] **12. Delete superseded `add_display_order.py` migration** ✓ 2026-04-04
  - File deleted

- [ ] **13. Fix `_is_locked` column heuristic in s1100**
  - File: `engine/s1100_persistence_writer.py:59-61`
  - Enumerate known columns explicitly instead of suffix check

- [ ] **14. Fix hardcoded `dev_name` in lot-phase-view endpoint**
  - File: `api/routers/developments.py`
  - JOIN to developments table and return real dev_name

- [ ] **15. Add `rng_seed` override parameter to convergence coordinator**
  - File: `engine/coordinator.py`
  - Default None = date-based seed; explicit = test-time control

## OPEN / TRACKING

- [ ] **16. Add tests: concurrent simulation runs + multi-dev convergence**
  - File: `devdb_python/tests/test_coordinator.py`

- [ ] **17. Retest end-to-end run after D-119 delivery schedule overhaul**
  - Run Waterton Station; verify Delivery Schedule Audit tab output

- [ ] **18. Define and implement S-0050 or formally defer with a D-number**
  - Currently "NOT IMPLEMENTED" with no tracking entry
