-- 030_delivery_months.sql
-- Replace delivery_window_start / delivery_window_end with delivery_months integer[]
-- on both sim_entitlement_delivery_config and sim_delivery_events.
-- Existing rows are converted: contiguous ranges expand to full arrays;
-- year-boundary ranges (start > end) wrap correctly.

-- ── sim_entitlement_delivery_config ─────────────────────────────────────────

ALTER TABLE sim_entitlement_delivery_config
  ADD COLUMN IF NOT EXISTS delivery_months integer[];

UPDATE sim_entitlement_delivery_config
SET delivery_months = CASE
    WHEN delivery_window_start IS NULL OR delivery_window_end IS NULL THEN NULL
    WHEN delivery_window_start <= delivery_window_end THEN
        ARRAY(SELECT generate_series(delivery_window_start, delivery_window_end))
    ELSE
        ARRAY(SELECT generate_series(delivery_window_start, 12))
        || ARRAY(SELECT generate_series(1, delivery_window_end))
END
WHERE delivery_window_start IS NOT NULL;

ALTER TABLE sim_entitlement_delivery_config
  DROP COLUMN IF EXISTS delivery_window_start,
  DROP COLUMN IF EXISTS delivery_window_end;

-- ── sim_delivery_events ──────────────────────────────────────────────────────

ALTER TABLE sim_delivery_events
  ADD COLUMN IF NOT EXISTS delivery_months integer[];

UPDATE sim_delivery_events
SET delivery_months = CASE
    WHEN delivery_window_start IS NULL OR delivery_window_end IS NULL THEN NULL
    WHEN delivery_window_start <= delivery_window_end THEN
        ARRAY(SELECT generate_series(delivery_window_start, delivery_window_end))
    ELSE
        ARRAY(SELECT generate_series(delivery_window_start, 12))
        || ARRAY(SELECT generate_series(1, delivery_window_end))
END
WHERE delivery_window_start IS NOT NULL;

ALTER TABLE sim_delivery_events
  DROP COLUMN IF EXISTS delivery_window_start,
  DROP COLUMN IF EXISTS delivery_window_end;
