-- Migration 0006: AI Correlation Analysis cache
-- Stores LLM-generated scientific assessments of multi-messenger correlation results.
-- Cache is keyed by (event_id, correlation_hash) so stale entries are detected
-- when the set of correlated candidates changes.

CREATE TABLE IF NOT EXISTS "core"."ai_correlation_analysis" (
  "id"               bigserial PRIMARY KEY NOT NULL,
  "event_id"         bigint    NOT NULL,
  "correlation_hash" text      NOT NULL,
  "model_name"       text      NOT NULL DEFAULT 'gemini-2.5-flash',
  "analysis_json"    jsonb     NOT NULL,
  "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"       timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_correlation_analysis_event_id_fk"
    FOREIGN KEY ("event_id") REFERENCES "core"."events"("id") ON DELETE CASCADE
);

-- Fast lookup by event when checking the cache
CREATE INDEX IF NOT EXISTS "idx_ai_corr_analysis_event_id"
  ON "core"."ai_correlation_analysis" ("event_id");

-- Unique cache key: one analysis per (event, candidate-set fingerprint)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_corr_analysis_hash"
  ON "core"."ai_correlation_analysis" ("event_id", "correlation_hash");
