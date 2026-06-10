-- Migration: 0003_alert_filtering
-- Adds alert-filtering metadata columns to core.events.
-- Safe to run on existing data: all new columns have defaults.

ALTER TABLE "core"."events"
  ADD COLUMN IF NOT EXISTS "lifecycle"           text        NOT NULL DEFAULT 'preliminary',
  ADD COLUMN IF NOT EXISTS "alert_type"          text,
  ADD COLUMN IF NOT EXISTS "classification_tier" text,
  ADD COLUMN IF NOT EXISTS "observatory"         text        NOT NULL DEFAULT 'Unknown',
  ADD COLUMN IF NOT EXISTS "is_retraction"       boolean     NOT NULL DEFAULT false;

-- Backfill lifecycle from existing status column for any pre-existing rows
UPDATE "core"."events"
  SET "lifecycle" = "status"
  WHERE "lifecycle" = 'preliminary' AND "status" IS NOT NULL;

-- Index to speed up sidebar queries that filter by lifecycle
CREATE INDEX IF NOT EXISTS idx_core_events_lifecycle
  ON "core"."events" ("lifecycle");

-- Index for retraction exclusion queries
CREATE INDEX IF NOT EXISTS idx_core_events_is_retraction
  ON "core"."events" ("is_retraction")
  WHERE "is_retraction" = false;
