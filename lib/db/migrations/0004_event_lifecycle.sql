-- Migration: 0004_event_lifecycle
-- Adds revision tracking columns and enforces one row per astrophysical event.

-- Step 1: Remove duplicate event_id rows that accumulated before this migration.
--         For each event_id, keep only the row with the largest id (most recent insert).
DELETE FROM "core"."events"
  WHERE "id" NOT IN (
    SELECT MAX("id") FROM "core"."events" GROUP BY "event_id"
  );

-- Step 2: Add lifecycle tracking columns (safe: default values, no breaking change).
ALTER TABLE "core"."events"
  ADD COLUMN IF NOT EXISTS "revision_count"  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latest_revision" text;

-- Step 3: Enforce one row per astrophysical event_id.
--         Must run AFTER deduplication above, otherwise it will fail.
CREATE UNIQUE INDEX IF NOT EXISTS idx_core_events_event_id_unique
  ON "core"."events" ("event_id");

-- Step 4: Composite index for sidebar queries (filter by type + lifecycle).
CREATE INDEX IF NOT EXISTS idx_core_events_type_lifecycle
  ON "core"."events" ("event_type", "lifecycle");
