-- 039_lot_date_overrides.sql
-- Planning layer: manager-entered date overrides for production meeting what-if testing.
-- One row per lot per date field. Override wins over MARKS in simulation.
-- Cleared manually or via batch reconciliation after ITK is updated.

CREATE TABLE IF NOT EXISTS devdb.sim_lot_date_overrides (
    override_id    SERIAL PRIMARY KEY,
    lot_id         BIGINT  NOT NULL REFERENCES devdb.sim_lots(lot_id) ON DELETE CASCADE,
    date_field     TEXT    NOT NULL,      -- 'date_td_hold','date_td','date_str','date_frm','date_cmp','date_cls'
    override_value DATE    NOT NULL,
    marks_value    DATE,                  -- MARKS date snapshotted at time of entry (for delta display)
    override_note  TEXT,
    created_by     TEXT    DEFAULT 'user',
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (lot_id, date_field)
);
