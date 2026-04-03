# DevDB Schema Reference

Task-specific reference. Load when working on: database schema, SQL queries, migrations, test fixtures, or building group data.

---

## Entity Hierarchy

```
sim_entitlement_groups
  sim_entitlement_delivery_config  (one row per group)
  sim_ent_group_developments       (junction to tbdDEVdev)

  tbdDEVdev
    sim_dev_defaults

    sim_delivery_events            (belongs to entitlement group, NOT individual development)
      sim_delivery_event_predecessors  (column: event_id, NOT delivery_event_id)
      sim_delivery_event_phases    (junction to sim_dev_phases)

    sim_legal_instruments
      sim_dev_phases
        sim_phase_product_splits
        sim_phase_builder_splits
        sim_lots
```

---

## Schema -- Core Tables

### sim_lots
```sql
lot_id                BIGINT PK        -- no IDENTITY; assigned by persistence_writer via MAX+offset (D-086)
projection_group_id   BIGINT FK
phase_id              BIGINT FK        -- -> sim_dev_phases
builder_id            INT
lot_source            STRING           -- 'real' or 'sim' -- IMMUTABLE AFTER CREATION
lot_number            STRING           -- hHSTidCode1 for real; null for sim
sim_run_id            BIGINT FK NULLABLE
lot_type_id           INT FK           -- -> ref_lot_types; determines projection group
building_group_id     BIGINT FK NULLABLE
date_ent              DATE
date_dev              DATE             -- set by lot_date_propagator from delivery event
date_td               DATE
date_td_hold          DATE             -- engine fills for TDA gap-fill only
date_str              DATE
date_str_source       STRING           -- 'actual','revised','scheduled','engine_filled','manual'
date_frm              DATE             -- informational only
date_cmp              DATE
date_cmp_source       STRING
date_cls              DATE
date_cls_source       STRING
created_at            TIMESTAMP
updated_at            TIMESTAMP
```

### sim_delivery_event_predecessors
```sql
id                    BIGINT PK
event_id              BIGINT           -- NOTE: column is 'event_id' not 'delivery_event_id'
predecessor_event_id  BIGINT
```

### sim_takedown_agreements
```sql
tda_id                BIGINT PK
tda_name              STRING
agreement_date        DATE
anchor_type           STRING
anchor_date           DATE
status                STRING           -- 'active', 'archived'
checkpoint_lead_days  INT              -- default 16; days before checkpoint to schedule hold
notes                 STRING
created_at            TIMESTAMP
updated_at            TIMESTAMP
```

---

## Building Group Mapping Status

Complete for 14 developments (585 lots): SC, CR, DT, JC, PC, RF, RP, TC, WP, WV, VI, WC, WT, WA.
No mapping required: HC, MC, BF, TD, TI.
Source: building_group_mapping_consolidated.csv

---

## Synthetic Test Fixtures (IDs >= 9001)

All synthetic fixture IDs use 9001+ to avoid collision with real data.

| Table | Synthetic IDs | Purpose |
|---|---|---|
| sim_entitlement_groups | ent_group_id=9001 | Waterton Station supply pipeline test |
| sim_delivery_events | 9001, 9002, 9003 | DE-01, DE-02, DE-03 |
| sim_dev_phases | 9001-9005 | WS SF ph1/ph2, WT Condo ph1/ph2, WV Condo ph1 |
| sim_dev_defaults | dev_id 9001-9003 | WS, WT, WV synthetic devs |
| dim_projection_groups | PG 165, 166, 167 | Synthetic PGs for WS/WT/WV |
| sim_ent_group_developments | id 9001-9003 | Links ent 9001 to devs 9001-9003 |
| sim_takedown_agreements | tda_id=9001 | WT-TDA-001 Scenario 2 |
| sim_takedown_checkpoints | 9001-9003 | CP1/CP2/CP3 |
| sim_lots | lot_id 9001-9030 | 30 TDA fixture lots |
| sim_takedown_agreement_lots | id 9001-9030 | TDA lot assignments |

Cleanup: DELETE WHERE id >= 9001 (or ent_group_id = 9001 etc.) for each table in dependency order.
