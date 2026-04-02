-- Migration 016: sim_lot_site_positions
-- Stores normalized (x, y) positions of real lots on a site plan.
-- lot_id is PK: a lot can only appear on one plan at a time.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'devdb' AND table_name = 'sim_lot_site_positions'
  ) THEN
    CREATE TABLE devdb.sim_lot_site_positions (
      lot_id     BIGINT PRIMARY KEY,
      plan_id    BIGINT NOT NULL,
      x          DOUBLE PRECISION NOT NULL,
      y          DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX idx_lot_site_positions_plan ON devdb.sim_lot_site_positions(plan_id);
  END IF;
END $$;
