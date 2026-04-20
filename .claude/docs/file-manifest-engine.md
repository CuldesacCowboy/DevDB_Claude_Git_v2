# DevDB File Manifest — Engine, Kernel & Tests (devdb_python/)

Load when working on: simulation engine modules, convergence coordinator, planning kernel, or test suite.

---

#### Engine (devdb_python/engine/)

### devdb_python/engine/connection.py
- Owns: DBConnection (Databricks, legacy), PGConnection (local Postgres, engine target), MARKSConnection (MARKS MySQL replica, read-only -- used by sync scripts only, never by engine modules per D-166)
- Imports: psycopg2, mysql.connector, databricks.sql, dotenv
- Imported by: coordinator.py, all engine modules, scripts/sync_marks.py
- Tables: none (connection factory)
- Last commit: 2026-04-19

### devdb_python/engine/config_loader.py
- Owns: load_delivery_config(conn, ent_group_id) — merges community row → global row → hardcoded defaults; returns fully-resolved dict with auto_schedule_enabled, max_deliveries_per_year, min_gap_months, delivery_months, min_d/u/uc/c_count, default_cmp_lag_days, default_cls_lag_days, feed_starts_mode; called by coordinator (for build lag defaults) and by P-0000 and P-0400
- Imports: pandas, logging
- Imported by: coordinator.py, p0000_placeholder_rebuilder.py, p0400_delivery_date_assigner.py
- Tables: sim_global_settings (SELECT id=1), sim_entitlement_delivery_config (SELECT by ent_group_id)
- Last commit: 2026-04-15

### devdb_python/engine/coordinator.py
- Owns: Convergence coordinator — runs starts pipeline then supply pipeline per ent_group; loops until convergence (max 10); convergence check compares sorted list of effective delivery dates; no domain logic — all logic lives in pipeline modules; passes resolved_events directly to P-07; returns (iterations, missing_params_devs, residual_gaps); injects _scheduling_horizon_days into build_lag_curves dict (alongside _td_to_str_lag, _default_cmp, _default_cls) so S-0500 can floor HC hold dates without a new signature param
- Imports: engine modules s0100-s1200 (including s0760), p0000-p0800, p_pre_locked_event_rebuilder, config_loader, kernel.plan, kernel.FrozenInput, psycopg2.extras, dateutil.relativedelta
- Imported by: routers/simulations.py, tests/test_coordinator.py
- Tables: reads/writes via all pipeline modules; sim_dev_params, sim_lot_date_overrides, sim_lot_date_violations, sim_instrument_builder_splits (coordinator itself does no direct sim_lots writes)
- Last commit: 2026-04-20

### devdb_python/engine/p_pre_locked_event_rebuilder.py
- Owns: Pre-supply-pipeline module — deletes all delivery events whose date_dev_actual IS NOT NULL and rebuilds them from sim_dev_phases.date_dev_actual; groups phases by date and INSERTs one event per date; returns count of new events created; locked_event_rebuilder(conn, ent_group_id) signature
- Imports: psycopg2
- Imported by: coordinator.py (called as first step of run_supply_pipeline)
- Tables: sim_delivery_events, sim_delivery_event_phases, sim_delivery_event_predecessors, sim_dev_phases, sim_ent_group_developments, sim_legal_instruments
- Last commit: 2026-04-08

### devdb_python/engine/s0100_lot_loader.py
- Owns: S-0100 -- loads real lots for ent_group from sim_lots into a DataFrame
- Imported by: coordinator.py
- Tables: sim_lots (SELECT real lots for ent_group)
- Last commit: 2026-03-25

### devdb_python/engine/s0200_date_actualizer.py
- Owns: S-0200 -- applies MARKsystems actual milestone dates to real lots via schedhousedetail join; uses resolve_marks_date() priority; numeric dev_code2 coercion fixed (VARCHAR cast) so dim_development bridge lookup works for all communities
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_* fields), schedhousedetail (SELECT)
- Last commit: 2026-04-14

### devdb_python/engine/s0300_gap_fill_engine.py
- Owns: S-0300 -- fills true-gap missing dates (requires anchor on both sides per D-084/D-085)
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_* fields in-memory DataFrame)
- Last commit: 2026-03-25

### devdb_python/engine/s0400_chronology_validator.py
- Owns: S-0400 -- detects date ordering violations; returns violation list without modifying lots
- Imported by: coordinator.py
- Tables: sim_lots (SELECT read-only)
- Last commit: 2026-03-25

### devdb_python/engine/s0500_takedown_engine.py
- Owns: S-0500 -- TDA checkpoint enforcement; writes date_td_hold_projected per D-087 using checkpoint_lead_days; DB+in-memory pre-clear wipes both date_td_hold_projected and date_td_projected (stale S-0760 output) before recomputing each run; NULL guards for checkpoint_number and lots_required_cumulative; past checkpoints (checkpoint_date < today) — count fulfillment for cumulative tracking, record residual gap, but NO HC assignment (obligation was missed, cannot be fulfilled retroactively); future checkpoints — apply scheduling_horizon_days floor: hold_date = max(natural_hold, today + horizon); excess push cycles only over future checkpoint hold dates; respects lot_quota cap and date_td_hold_is_locked; never writes actuals; accepts scheduling_horizon_days param (default 0) injected by coordinator via build_lag_curves
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_td_hold_projected, date_td_projected), sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_agreement_lots
- Last commit: 2026-04-20

### devdb_python/engine/seasonal_weights.py
- Owns: Shared seasonal weight sets (month→fractional weight, sums to 1.0) used by S-0600 and P-0000 for monthly demand/pace allocation
- Imported by: s0600_demand_generator.py, p0000_placeholder_rebuilder.py
- Tables: none
- Last commit: 2026-04-03

### devdb_python/engine/s0760_hc_bldr_date_projector.py
- Owns: S-0760 -- writes date_td_projected for HC-held lots based on demand allocation order; identifies HC lots (date_td_hold or date_td_hold_projected set, no date_td, no date_str, not locked); calls demand_allocator over full snapshot; filters allocation to HC lot_ids; writes date_td_projected = first-of-month - td_to_str_lag for each allocated HC lot; after writing, clears date_td_hold_projected for any lot where bldr_date < hold_date (demand path covers lot before HC would be entered — HC hold not needed); never writes date_td actual; runs between S-06 and kernel pass
- Imports: engine.s0700_demand_allocator, pandas, datetime
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_td_projected, UPDATE date_td_hold_projected)
- Last commit: 2026-04-20

### devdb_python/engine/s0600_demand_generator.py
- Owns: S-0600 -- generates monthly demand series for each phase; vectorized; capacity-capped per D-138
- Imported by: coordinator.py
- Tables: sim_dev_phases, sim_phase_product_splits, sim_lots (SELECT)
- Last commit: 2026-04-03

### devdb_python/engine/s0205_building_group_sync.py
- Owns: S-0205 -- propagates MIN(date_str, date_cmp, date_td) within building groups for real/pre lots; runs between S-0200 and S-0300; returns early if no lots have building_group_id set
- Imported by: coordinator.py
- Tables: none (pure DataFrame transform)
- Last commit: 2026-04-14

### devdb_python/engine/s0700_demand_allocator.py
- Owns: S-0700 -- allocates demand slots to real/sim lots; building-group-aware: groups are atomic units (all lots in a group consume N demand slots and share the first slot's month); positional merge; no carry-forward; empty lot_snapshot does NOT short-circuit
- Imported by: kernel/planning_kernel.py
- Tables: none (pure DataFrame transform)
- Last commit: 2026-04-19

### devdb_python/engine/s0800_temp_lot_generator.py
- Owns: S-0800 -- generates sim lots for unmet demand; date_str = demand slot month (or deferred); date_td = date_str per D-137/D-142; deferred-start logic; building group generation: when phase_building_config is provided, generates lots in groups using bg_templates; synthetic negative building_group_id values assigned (no DB FK); all units in a building share first slot's date_str
- Imported by: kernel/planning_kernel.py
- Tables: none (builds list; persistence is in s1100)
- Last commit: 2026-04-14

### devdb_python/engine/s0810_building_group_enforcer.py
- Owns: S-0810 -- enforces MIN(date_str) per building_group_id across sim lots per D-133
- Imported by: kernel/planning_kernel.py
- Tables: none (pure DataFrame transform)
- Last commit: 2026-03-25

### devdb_python/engine/s0820_post_generation_chronology_guard.py
- Owns: S-0820 -- discards sim lots with chronology violations post-generation; warns on fully-cleared phases
- Imported by: kernel/planning_kernel.py
- Tables: none (pure DataFrame filter)
- Last commit: 2026-03-25

### devdb_python/engine/s0900_builder_assignment.py
- Owns: S-0900 -- two functions: builder_assignment() assigns builder_id to sim/temp lots in memory (pure, no DB); assign_real_lot_builders() DB pre-pass assigns builder_id to real/pre lots where COALESCE(builder_id_override, builder_id) IS NULL using same proportional split logic; both share _apply_splits_to_indices() helper; assign_real_lot_builders() called once per coordinator run before iteration loop (idempotent); input builder_splits dict is {phase_id: [...]} loaded by coordinator via sim_instrument_builder_splits join
- Imported by: coordinator.py
- Tables: sim_lots (SELECT real/pre lots, UPDATE builder_id via execute_values)
- Last commit: 2026-04-15

### devdb_python/engine/s1000_demand_derived_date_writer.py
- Owns: S-1000 -- writes MIN(date_str) per phase to sim_dev_phases.date_dev_projected
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE date_dev_projected)
- Last commit: 2026-03-25

### devdb_python/engine/s1050_real_lot_projections.py
- Owns: S-1050 -- writes projected STR/CMP/CLS dates to real P lots at annual_starts_target pace from sim_dev_params; clears stale projections before writing; applies str_to_cmp and cmp_to_cls lag curves per unit; skips locked lots; independent of kernel capacity logic
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_str_projected, date_cmp_projected, date_cls_projected), sim_dev_params (SELECT)
- Last commit: 2026-04-19

### devdb_python/engine/s1100_persistence_writer.py
- Owns: S-1100 -- atomic DELETE+INSERT of sim lots; assigns lot_id via MAX(lot_id)+offset per D-086; _LOCKED_COLS frozenset defaults NOT NULL boolean columns (locked flags + excluded) to False for sim lots; Step 3 re-stamps date_ent from sim_dev_phases onto newly-inserted sim lots (INSERT writes date_ent=None; phase-level value restored here per migration 023)
- Imported by: coordinator.py
- Tables: sim_lots (DELETE sim rows, INSERT new sim rows, UPDATE date_ent), sim_dev_phases (SELECT date_ent)
- Last commit: 2026-04-19

### devdb_python/engine/s1200_ledger_aggregator.py
- Owns: S-1200 -- creates/replaces v_sim_ledger_monthly view; COUNT-based pipeline stage counts; sawtooth stacked area shape with D and H layers; WHERE excluded IS NOT TRUE filter
- Imported by: coordinator.py
- Tables: v_sim_ledger_monthly (CREATE OR REPLACE VIEW over sim_lots)
- Last commit: 2026-04-14

### devdb_python/engine/p0000_placeholder_rebuilder.py
- Owns: P-0000 -- rebuilds placeholder delivery events per D-139 cross-dev scheduling lean rule; D-balance floor enforcement using min_d_count/per-status floors from sim_entitlement_delivery_config; uses delivery_months integer[] (frozenset) for window logic — supports arbitrary month sets; Step 7 auto-generates sim_delivery_event_predecessors rows between consecutive events per dev (ordered by sequence_number) so P-0200/P-0400 enforce absolute phase ordering; step 3c uses `date_ent IS NOT NULL` (not `date_dev IS NULL`) to detect real pending lots — survives P-07 multi-iteration write-back; pd.NaT normalized to None at load time; delivery_tier gate in outer loop (tier-N held until all tier-(N-1) scheduled); dev_phases sorted by (tier, seq); tier check in inner co-bundling loop; feed_starts_mode=True bypasses both tier gates while predecessor links still enforce tier ordering
- Imported by: coordinator.py
- Tables: sim_delivery_events, sim_delivery_event_phases, sim_delivery_event_predecessors, sim_dev_phases, sim_entitlement_delivery_config (SELECT/INSERT/UPDATE)
- Last commit: 2026-04-15

### devdb_python/engine/p0100_actual_date_applicator.py
- Owns: P-0100 -- applies locked delivery event dates to sim_dev_phases.date_dev_projected per D-112/D-125
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE), sim_delivery_events, sim_delivery_event_phases (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0200_dependency_resolver.py
- Owns: P-0200 -- resolves delivery event predecessor chains; uses event_id column (not delivery_event_id)
- Imported by: coordinator.py
- Tables: sim_delivery_events, sim_delivery_event_predecessors (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0300_constraint_urgency_ranker.py
- Owns: P-0300 -- ranks phases by delivery urgency based on inventory exhaustion
- Imported by: coordinator.py
- Tables: sim_dev_phases, sim_lots, sim_phase_product_splits (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0400_delivery_date_assigner.py
- Owns: P-0400 -- assigns delivery dates to placeholder events; never moves placeholder earlier than P-0000 wrote per D-141; uses delivery_months integer[] (frozenset) — replaced window_start/end range checks; predecessor sequence floor applied after demand/placeholder guards as absolute constraint (phase ordering always wins)
- Imported by: coordinator.py
- Tables: sim_delivery_events (UPDATE), sim_dev_phases, sim_delivery_event_predecessors (SELECT)
- Last commit: 2026-04-10

### devdb_python/engine/p0500_eligibility_updater.py
- Owns: P-0500 -- updates phase delivery eligibility flags after date assignment; uses event_id column
- Imported by: coordinator.py
- Tables: sim_delivery_events, sim_delivery_event_predecessors (SELECT/UPDATE)
- Last commit: 2026-03-25

### devdb_python/engine/p0600_phase_date_propagator.py
- Owns: P-0600 -- propagates delivery event dates to child phases' date_dev_projected unconditionally per D-123
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE), sim_delivery_event_phases, sim_delivery_events (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0700_lot_date_propagator.py
- Owns: P-0700 -- accepts resolved_events list of (event_id, projected_date); queries sim_delivery_event_phases to find child phases; propagates date_dev_projected to sim lots and real lots where date_dev IS NULL per D-113
- Imported by: coordinator.py
- Tables: sim_delivery_event_phases (SELECT phase_id), sim_lots (UPDATE date_dev)
- Last commit: 2026-04-19

### devdb_python/engine/p0800_sync_flag_writer.py
- Owns: P-0800 -- writes needs_rerun and sync status flags to sim_dev_phases
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE)
- Last commit: 2026-03-25

---

#### Kernel (devdb_python/kernel/)

### devdb_python/kernel/frozen_input.py
- Owns: FrozenInput dataclass -- immutable snapshot of all data the planning kernel needs; includes phase_building_config: dict {phase_id: [(building_count, units_per_building)]} for multi-family phases
- Imports: dataclasses, pandas
- Imported by: coordinator.py, kernel/planning_kernel.py, kernel/frozen_input_builder.py
- Tables: none (pure dataclass)
- Last commit: 2026-04-14

### devdb_python/kernel/frozen_input_builder.py
- Owns: Builds FrozenInput from database queries; _load_phase_capacity sorts by (tier NULLS FIRST, seq, phase_id); _load_phase_building_config loads sim_phase_building_config rows → {phase_id: [(building_count, units_per_building)]}
- Imports: engine.connection, frozen_input
- Imported by: coordinator.py
- Tables: sim_lots, sim_dev_phases, sim_phase_product_splits, sim_phase_building_config (SELECT)
- Last commit: 2026-04-19

### devdb_python/kernel/planning_kernel.py
- Owns: plan() entry point -- wires S-0700 → S-0800 → S-0810 sequentially; passes phase_building_config from FrozenInput to S-0800; pure function (no DB access)
- Imports: frozen_input, proposal, proposal_validator, s0700, s0800, s0810
- Imported by: coordinator.py
- Tables: none (pure transform)
- Last commit: 2026-04-14

### devdb_python/kernel/proposal.py
- Owns: Proposal dataclass -- output of plan(); holds generated sim lots DataFrame and warnings
- Imports: dataclasses, pandas
- Imported by: planning_kernel.py, coordinator.py
- Tables: none
- Last commit: 2026-03-25

### devdb_python/kernel/proposal_validator.py
- Owns: Validates a Proposal against business rules before coordinator accepts it
- Imports: proposal, frozen_input
- Imported by: planning_kernel.py
- Tables: none (pure validation)
- Last commit: 2026-03-27

---

#### Tests (devdb_python/tests/)

### devdb_python/tests/test_s01_s04.py
- Owns: Tests for starts pipeline S-0100 through S-0400 (lot_loader, date_actualizer, gap_fill_engine, chronology_validator)
- Imports: engine modules s0100-s0400, pytest
- Tables: sim_lots, schedhousedetail (via test fixtures)
- Last commit: 2026-03-25

### devdb_python/tests/test_s05_s08.py
- Owns: Tests for S-0500 through S-0800 (takedown_engine, demand_generator, demand_allocator, temp_lot_generator)
- Imports: engine modules s0500-s0800, pytest
- Tables: sim_lots, sim_takedown_*, sim_dev_phases, sim_phase_product_splits (via fixtures)
- Last commit: 2026-03-27

### devdb_python/tests/test_s0810_s0820.py
- Owns: Tests for S-0810 (building_group_enforcer) and S-0820 (post_generation_chronology_guard)
- Imports: s0810, s0820, pytest
- Tables: none (DataFrame-only tests)
- Last commit: 2026-03-25

### devdb_python/tests/test_s09_s12.py
- Owns: Tests for S-0900 through S-1200 (builder_assignment, demand_derived_date_writer, persistence_writer, ledger_aggregator)
- Imports: engine modules s0900-s1200, pytest
- Tables: sim_lots, sim_dev_phases, sim_phase_builder_splits (via fixtures)
- Last commit: 2026-03-25

### devdb_python/tests/test_p01_p08.py
- Owns: Tests for supply pipeline P-0100 through P-0800
- Imports: engine modules p0100-p0800, pytest
- Tables: sim_delivery_events, sim_dev_phases, sim_lots (via fixtures)
- Last commit: 2026-03-25

### devdb_python/tests/test_coordinator.py
- Owns: End-to-end convergence test for coordinator (ent_group_id=9002)
- Imports: engine.coordinator, pytest
- Tables: all (runs full pipeline against local Postgres)
- Last commit: 2026-03-25

### devdb_python/tests/test_kernel_scenarios.py
- Owns: Scenario-pack tests for planning kernel (FrozenInput fixtures, 6 truth cases); _make_frozen_input helper includes phase_building_config param; 6/6 pass
- Imports: kernel.planning_kernel, kernel.frozen_input, engine.s0810, engine.s1100, pytest
- Tables: none (pure DataFrame fixtures)
- Last commit: 2026-04-14

### devdb_python/tests/pokemon/db.py
- Owns: Shared Pokemon test helpers: make_lots(), reset_mutable_state() (deletes from sim_delivery_event_predecessors before sim_delivery_events to avoid FK violation), check_violations(), check_sim_lots_exist(), check_delivery_events(), check_no_duplicate_lot_ids(), _pass()
- Imports: engine modules, psycopg2
- Tables: sim_lots, sim_lot_date_violations, sim_delivery_events, sim_delivery_event_predecessors (via reset/check queries)
- Last commit: 2026-04-14

### devdb_python/tests/pokemon/constants.py
- Owns: Shared Pokemon test constants (ENT_GROUP_IDs, DEV_IDs range table)
- Last commit: 2026-04-04

### devdb_python/tests/pokemon/communities/ (14 scenario modules)
- Owns: One module per Pokemon community (pallet_town through mahogany_town); each has install() (idempotent permanent objects), reset(), setup(), assert_results(); 14 scenarios testing various delivery scheduling behaviors; viridian_city and saffron_city updated to expected_auto=2 (exhaustion fallback schedules one event per undelivered phase when permanent D-status lots mask co-bundling signal)
- Tables: all sim_* tables (via install/reset helpers)
- Last commit: 2026-04-14

---

#### Scripts (devdb_python/scripts/)

### devdb_python/scripts/sync_marks.py
- Owns: On-demand sync of MARKS MySQL replica tables into devdb_ext (local Postgres) per D-166; syncs schedhousedetail and housemaster via full TRUNCATE+INSERT; column intersection handles schema drift; --dry-run and --tables flags; prints row counts and elapsed time; raises clearly if MARKS server unreachable
- Imports: engine.connection.MARKSConnection, psycopg2, dotenv, argparse
- Tables: devdb_ext.schedhousedetail (TRUNCATE+INSERT), devdb_ext.housemaster (TRUNCATE+INSERT)
- Last commit: 2026-04-19

### devdb_python/scripts/import_housemaster_builder.py
- Owns: One-time import — reads housemaster.csv (MARKS export), joins on DEVELOPMENTCODE+HOUSENUMBER, sets sim_lots.builder_id (MARKS tier); dry-run by default (--apply to write); scoped by --dev flag; MARKS wins on conflict with existing builder_id
- Imports: psycopg2, csv, argparse
- Tables: sim_lots (UPDATE builder_id), dim_builders (SELECT marks_company_code)
- Last commit: 2026-04-12

### devdb_python/scripts/import_phase_delivery_dates.py
- Owns: One-time import — reads qrxPYM0C_03_Month.csv, finds past months where LotsDeveloped > 0 per development, assigns to sim_dev_phases.date_dev_actual in sequence_number order; skips already-set phases; dry-run by default (--apply to write); --dev flag for single-dev scope; p_pre derives delivery events automatically on next sim run
- Imports: psycopg2, csv, argparse, collections.defaultdict
- Tables: sim_dev_phases (UPDATE date_dev_actual), developments (SELECT)
- Last commit: 2026-04-13

### devdb_python/scripts/import_builder_splits_from_csv.py
- Owns: Imports builder split percentages from CSV into sim_phase_builder_splits
- Imports: psycopg2, csv
- Tables: sim_phase_builder_splits (INSERT/UPDATE)
- Last commit: 2026-04-10
