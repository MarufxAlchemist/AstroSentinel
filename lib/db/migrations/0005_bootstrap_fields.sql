-- Migration 0005: Bootstrap fields
-- Adds source tracking and historical flag to core.events.
--
-- source       : origin of the row — 'kafka' (live alert) or 'bootstrap' (seed data)
-- is_historical: true for rows loaded from recent_events.json at startup

ALTER TABLE core.events
  ADD COLUMN IF NOT EXISTS source       text    NOT NULL DEFAULT 'kafka',
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_core_events_source
  ON core.events (source);

CREATE INDEX IF NOT EXISTS idx_core_events_is_historical
  ON core.events (is_historical)
  WHERE is_historical = true;
