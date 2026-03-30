-- Migration 005: Add sequences to TDA tables
-- sim_takedown_checkpoints.checkpoint_id,
-- sim_takedown_agreement_lots.id, and
-- sim_takedown_lot_assignments.assignment_id have no
-- sequence/default. This migration adds them, advancing each
-- sequence past the current MAX to avoid collisions with
-- existing rows.

-- sim_takedown_checkpoints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attrdef ad
    JOIN pg_attribute a ON a.attrelid = ad.adrelid
                       AND a.attnum   = ad.adnum
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'devdb'
      AND c.relname = 'sim_takedown_checkpoints'
      AND a.attname = 'checkpoint_id'
  ) THEN
    CREATE SEQUENCE IF NOT EXISTS
      devdb.sim_takedown_checkpoints_checkpoint_id_seq;
    PERFORM setval(
      'devdb.sim_takedown_checkpoints_checkpoint_id_seq',
      COALESCE((SELECT MAX(checkpoint_id)
                FROM devdb.sim_takedown_checkpoints), 0) + 1,
      false
    );
    ALTER TABLE devdb.sim_takedown_checkpoints
      ALTER COLUMN checkpoint_id
      SET DEFAULT nextval(
        'devdb.sim_takedown_checkpoints_checkpoint_id_seq'
      );
  END IF;
END $$;

-- sim_takedown_agreement_lots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attrdef ad
    JOIN pg_attribute a ON a.attrelid = ad.adrelid
                       AND a.attnum   = ad.adnum
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'devdb'
      AND c.relname = 'sim_takedown_agreement_lots'
      AND a.attname = 'id'
  ) THEN
    CREATE SEQUENCE IF NOT EXISTS
      devdb.sim_takedown_agreement_lots_id_seq;
    PERFORM setval(
      'devdb.sim_takedown_agreement_lots_id_seq',
      COALESCE((SELECT MAX(id)
                FROM devdb.sim_takedown_agreement_lots), 0) + 1,
      false
    );
    ALTER TABLE devdb.sim_takedown_agreement_lots
      ALTER COLUMN id
      SET DEFAULT nextval(
        'devdb.sim_takedown_agreement_lots_id_seq'
      );
  END IF;
END $$;

-- sim_takedown_lot_assignments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attrdef ad
    JOIN pg_attribute a ON a.attrelid = ad.adrelid
                       AND a.attnum   = ad.adnum
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'devdb'
      AND c.relname = 'sim_takedown_lot_assignments'
      AND a.attname = 'assignment_id'
  ) THEN
    CREATE SEQUENCE IF NOT EXISTS
      devdb.sim_takedown_lot_assignments_assignment_id_seq;
    PERFORM setval(
      'devdb.sim_takedown_lot_assignments_assignment_id_seq',
      COALESCE((SELECT MAX(assignment_id)
                FROM devdb.sim_takedown_lot_assignments), 0) + 1,
      false
    );
    ALTER TABLE devdb.sim_takedown_lot_assignments
      ALTER COLUMN assignment_id
      SET DEFAULT nextval(
        'devdb.sim_takedown_lot_assignments_assignment_id_seq'
      );
  END IF;
END $$;
