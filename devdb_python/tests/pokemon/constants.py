# constants.py — Reserved ID ranges and community registry for Pokemon test suite.
#
# ID reservation strategy:
#   All sequenced tables (sim_entitlement_groups, developments, sim_dev_phases,
#   sim_legal_instruments, sim_building_groups, sim_tda) use IDs in reserved ranges.
#   Production sequences are already past 9000; test IDs in 7000-range are permanently
#   safe because sequences never decrement.
#   After install, sequences for lower-valued tables (developments ~115,
#   phases ~200, instruments ~50) are advanced past the reserved ceiling.
#
# Tables whose IDs are sequence-assigned at install time (no reservation needed):
#   sim_lots, sim_delivery_events, sim_delivery_event_phases,
#   sim_phase_product_splits, sim_takedown_checkpoints, sim_takedown_agreement_lots

# ── Reserved ranges ────────────────────────────────────────────────────────────

ENT_GROUP_RANGE   = (7001, 7030)   # sim_entitlement_groups.ent_group_id
DEV_RANGE         = (7001, 7030)   # developments.dev_id  (same space, different table)
INSTRUMENT_RANGE  = (70001, 70050) # sim_legal_instruments.instrument_id
PHASE_RANGE       = (70001, 70100) # sim_dev_phases.phase_id
BUILDING_GRP_RANGE = (7001, 7030)  # sim_building_groups.building_group_id
TDA_RANGE         = (7001, 7030)   # sim_takedown_agreements.tda_id

# Sequence ceiling — advance all lower-valued sequences to at least this value
# so future production inserts never collide with our reserved IDs.
SEQUENCE_CEILING = {
    "devdb.developments_dev_id_seq":            7030,
    "devdb.sim_legal_instruments_id_seq":        70050,
    "devdb.sim_dev_phases_id_seq":               70100,
    "devdb.sim_building_groups_id_seq":          7030,
    "devdb.sim_takedown_agreements_id_seq":      7030,
    "devdb.sim_takedown_checkpoints_checkpoint_id_seq": 7030,
}
# sim_entitlement_groups sequence is already at ~9003 — no advancement needed.

# ── Community registry ─────────────────────────────────────────────────────────

# Maps module name → (ent_group_id, description)
REGISTRY = {
    "pallet_town":    (7001, "Sc-5:  Happy Path Baseline"),
    "viridian_city":  (7002, "Sc-1:  Multi-Product Convergence"),
    "pewter_city":    (7003, "Sc-6:  Chronology Violation"),
    "cerulean_city":  (7004, "Sc-2:  TDA Gap-Fill"),
    "vermilion_city": (7005, "Sc-8:  Locked Actuals"),
    "lavender_town":  (7006, "Sc-7:  Gap-Fill No Anchor"),
    "celadon_city":   (7007, "Sc-4:  Real vs Temp Competition"),
    "fuchsia_city":   (7008, "Sc-3:  Building Group Close Dates"),
    "saffron_city":   (7009, "Sc-9:  Placeholder Auto-Scheduling"),
    "cinnabar_island":(7010, "Sc-10: Persistence Rollback"),
    "goldenrod_city": (7011, "DS-A:  Narrow Delivery Window (Sep-Oct)"),
    "ecruteak_city":  (7012, "DS-B:  Min-Gap 18 Months"),
    "mahogany_town":  (7013, "DS-C:  Year-Boundary Window (Nov-Feb)"),
    "azalea_town":    (7014, "DS-D:  Multi-Dev Urgency Race"),
}

ALL_ENT_GROUP_IDS = [v[0] for v in REGISTRY.values()]

# Azalea Town has 3 devs
AZALEA_DEV_IDS = [7014, 7015, 7016]
