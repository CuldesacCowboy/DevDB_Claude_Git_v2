-- Migration 022: Rename ledger_start_date → date_paper on sim_entitlement_groups
-- Also exposes date_ent_actual (already exists from migration 001) as "Entitlements Date".
-- Note: this rename may already be applied to the DB instance. The DO block is idempotent.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb'
          AND table_name   = 'sim_entitlement_groups'
          AND column_name  = 'ledger_start_date'
    ) THEN
        ALTER TABLE devdb.sim_entitlement_groups
            RENAME COLUMN ledger_start_date TO date_paper;
    END IF;
END $$;
