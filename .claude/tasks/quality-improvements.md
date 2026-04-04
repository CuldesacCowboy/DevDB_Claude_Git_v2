# DevDB Quality Improvements
*Generated: 2026-04-04*

## CRITICAL

- [x] **1. Add sequences to `sim_lots.lot_id` and `sim_lot_date_violations.violation_id`** ✓ 2026-04-04
  - migration 028 created; s1100 and coordinator updated to omit PK from insert dict

- [x] **2. Add sequences to `sim_delivery_events.delivery_event_id` and `sim_delivery_event_phases.id`** ✓ 2026-04-04
  - Included in migration 028; p0000 uses nextval() instead of MAX+1

## HIGH

- [x] **3. Replace f-string SQL with parameterized queries in engine** ✓ 2026-04-04
  - All 17 engine modules converted; ANY(%s) for IN-lists, UNNEST for CTEs

- [x] **4. Remove `conn._conn` direct access in coordinator** ✓ 2026-04-04
  - Added PGConnection.execute_values(); coordinator + s0200 updated

- [x] **5. Wrap each migration in an explicit transaction (rollback on failure)** ✓ 2026-04-04
  - api/main.py: autocommit=False; commit after schema_migrations INSERT; rollback+raise on failure

## MEDIUM

- [x] **6. Replace `datetime.utcnow()` with `datetime.now(timezone.utc)`** ✓ 2026-04-04
  - coordinator.py: import timezone added, utcnow() replaced

- [x] **7. Apply `API_BASE` from `config.js` to all 8 remaining frontend files** ✓ 2026-04-04
  - PdfCanvas.jsx, PhaseColumn.jsx, LotPhaseView.jsx, useLotPhaseData.js,
    useDragHandler.js, InstrumentContainer.jsx, CommunityDevelopmentsView.jsx updated
  - useApiMutation.js takes URL as param from callers — no change needed

- [x] **8. Add timeout to `POST /simulations/run`** ✓ 2026-04-04
  - ThreadPoolExecutor future with 120s timeout; returns HTTP 504 on breach

- [x] **9. Fix `MAX(sequence_number)` race in phase creation** ✓ 2026-04-04
  - SELECT FOR UPDATE on instrument row; MAX+1 subquery inside INSERT VALUES

- [x] **10. Update file-manifest-migrations.md — add missing migrations 013-019 and 022** ✓ 2026-04-04
  - Added 013-019, 022, and 028 to file-manifest-migrations.md

## LOW / CODE QUALITY

- [x] **11. Replace `print()` with `logging` throughout engine** ✓ 2026-04-04
  - 15 modules converted; logger.info/warning per module __name__

- [x] **12. Delete superseded `add_display_order.py` migration** ✓ 2026-04-04
  - File deleted

- [x] **13. Fix `_is_locked` column heuristic in s1100** ✓ 2026-04-04
  - Replaced suffix check with explicit frozenset of 8 known lock columns

- [x] **14. Fix hardcoded `dev_name` in lot-phase-view endpoint** ✓ 2026-04-04
  - Fetches real dev_name from developments table; 404 if dev_id not found

- [x] **15. Add `rng_seed` override parameter to convergence coordinator** ✓ 2026-04-04
  - rng_seed=None uses date-based seed; explicit int for test-time control

## OPEN / TRACKING

- [x] **16. Add tests: concurrent simulation runs + multi-dev convergence** ✓ 2026-04-04
  - New file: `tests/test_coordinator_reliability.py`
  - Tests: multi-dev convergence, determinism (rng_seed), concurrent threads + PK collision check

- [x] **17. Retest end-to-end run after D-119 delivery schedule overhaul** ✓ 2026-04-04
  - Waterton Station (ent_group 9002) run verified manually
  - D-119: first auto event is Nov 27 (last locked Oct 26) ✓
  - One delivery date per year per ent-group for all auto events ✓
  - D-139 cross-dev bundling: Jun 29 delivers Pointe ph.4 + Village ph.4 + SC ph.2 ✓
  - D/U/UC counts coherent: locked events D=Units UC=0; auto events show live demand pool ✓

- [x] **18. Define and implement S-0050 or formally defer with a D-number** ✓ 2026-04-04
  - Formally deferred: D-155 added to decision-log.md
  - Rationale: coordinator pre-loads shared config; per-dev param queries are fast local PG; 0.5s total run time makes S-0050 not worth the refactor churn
