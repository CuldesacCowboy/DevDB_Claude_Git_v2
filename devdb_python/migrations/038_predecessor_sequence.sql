-- Migration 038: Add auto-increment sequence to sim_delivery_event_predecessors.id
--
-- The table was created with id BIGINT NOT NULL but no default / sequence.
-- The engine now auto-generates predecessor rows from phase sequence_number
-- ordering and needs to insert without supplying explicit IDs.

CREATE SEQUENCE IF NOT EXISTS devdb.sim_delivery_event_predecessors_id_seq;

ALTER TABLE devdb.sim_delivery_event_predecessors
    ALTER COLUMN id SET DEFAULT nextval('devdb.sim_delivery_event_predecessors_id_seq');

-- Seed the sequence above any existing rows so future inserts don't collide.
SELECT setval(
    'devdb.sim_delivery_event_predecessors_id_seq',
    COALESCE((SELECT MAX(id) FROM devdb.sim_delivery_event_predecessors), 0) + 1,
    false
);
