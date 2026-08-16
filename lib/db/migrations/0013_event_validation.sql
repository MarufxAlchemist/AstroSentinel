-- Phase 3: persist scientific validation diagnostics and the quality score.
--
-- Validation runs in the Python normalizer on the synchronous ingestion path
-- (spec section 41) and produces, per event:
--   * a list of diagnostics (level / code / field / message / value)
--   * a transparent quality assessment with per-component deductions
--
-- Stored as JSONB rather than a child table: the payload is read whole, per
-- event, and never queried across events by individual diagnostic. Indexing
-- the two fields that ARE filtered on (status, score) covers the real access
-- patterns without the join cost of a normalized table.

ALTER TABLE core.events ADD COLUMN IF NOT EXISTS validation    jsonb;
ALTER TABLE core.events ADD COLUMN IF NOT EXISTS quality       jsonb;
ALTER TABLE core.events ADD COLUMN IF NOT EXISTS quality_score smallint;
ALTER TABLE core.events ADD COLUMN IF NOT EXISTS validation_status text;

COMMENT ON COLUMN core.events.validation IS
  'Scientific validation report: {status, worstLevel, counts, diagnostics[]}. Describes the data, never rejects it.';
COMMENT ON COLUMN core.events.quality IS
  'Transparent quality assessment with per-component scores and itemised deductions.';
COMMENT ON COLUMN core.events.quality_score IS
  'Overall quality 0-100, denormalised from quality->>overall for indexing/sorting.';
COMMENT ON COLUMN core.events.validation_status IS
  'PASS | WARNING | FAIL, denormalised from validation->>status for filtering.';

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_quality_score_range;
ALTER TABLE core.events ADD CONSTRAINT chk_quality_score_range
  CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100));

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_validation_status;
ALTER TABLE core.events ADD CONSTRAINT chk_validation_status
  CHECK (validation_status IS NULL
         OR validation_status IN ('PASS','WARNING','FAIL','UNKNOWN'));

-- Dashboard: "show me events that failed validation", "worst quality first".
CREATE INDEX IF NOT EXISTS events_validation_status_idx
  ON core.events (validation_status) WHERE validation_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_quality_score_idx
  ON core.events (quality_score);
