-- 088_performance_indexes.sql
-- Add missing indexes identified from pg_stat_user_tables analysis.
-- These tables had millions of sequential reads with zero index scans.

-- sim_tda_lot_bank_members: 43M seq reads. Queries filter by lot_id for FK cascades.
CREATE INDEX IF NOT EXISTS idx_tda_bank_members_lot ON sim_tda_lot_bank_members (lot_id);

-- sim_takedown_agreement_lots: 1M seq reads, 0 index scans. Queries filter by tda_id and lot_id.
CREATE INDEX IF NOT EXISTS idx_tda_agreement_lots_tda ON sim_takedown_agreement_lots (tda_id);
CREATE INDEX IF NOT EXISTS idx_tda_agreement_lots_lot ON sim_takedown_agreement_lots (lot_id);

-- sim_delivery_event_phases: 1M seq reads, 0 index scans. Queries filter by delivery_event_id and phase_id.
CREATE INDEX IF NOT EXISTS idx_delivery_event_phases_event ON sim_delivery_event_phases (delivery_event_id);
CREATE INDEX IF NOT EXISTS idx_delivery_event_phases_phase ON sim_delivery_event_phases (phase_id);

-- sim_delivery_event_predecessors: 600K seq reads, 0 index scans.
CREATE INDEX IF NOT EXISTS idx_delivery_predecessors_event ON sim_delivery_event_predecessors (event_id);
CREATE INDEX IF NOT EXISTS idx_delivery_predecessors_pred ON sim_delivery_event_predecessors (predecessor_event_id);

-- sim_ent_group_developments: 1M seq reads. Queries filter by ent_group_id and dev_id.
CREATE INDEX IF NOT EXISTS idx_segd_ent_group ON sim_ent_group_developments (ent_group_id);
CREATE INDEX IF NOT EXISTS idx_segd_dev ON sim_ent_group_developments (dev_id);

-- sim_takedown_checkpoints: commonly joined to tda_id
CREATE INDEX IF NOT EXISTS idx_tda_checkpoints_tda ON sim_takedown_checkpoints (tda_id);

-- sim_takedown_lot_assignments: commonly joined to checkpoint_id and lot_id
CREATE INDEX IF NOT EXISTS idx_tda_lot_assignments_cp ON sim_takedown_lot_assignments (checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_tda_lot_assignments_lot ON sim_takedown_lot_assignments (lot_id);

-- sim_lots: building_group_id used in group sync queries
CREATE INDEX IF NOT EXISTS idx_sim_lots_bg ON sim_lots (building_group_id) WHERE building_group_id IS NOT NULL;

-- sim_legal_instruments: dev_id for phase hierarchy joins
CREATE INDEX IF NOT EXISTS idx_instruments_dev ON sim_legal_instruments (dev_id);

-- sim_dev_phases: instrument_id for hierarchy joins
CREATE INDEX IF NOT EXISTS idx_phases_instrument ON sim_dev_phases (instrument_id);

-- sim_lot_date_overrides: lot_id for lot-level override lookups
CREATE INDEX IF NOT EXISTS idx_lot_overrides_lot ON sim_lot_date_overrides (lot_id);
