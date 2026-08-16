-- 0016_research_interest.sql
-- Phase 7: research interest score (spec section 44).
--
-- THREE SCORES, THREE QUESTIONS
-- -----------------------------
-- The pipeline now carries three scores and they must never be conflated:
--
--   quality_score      Is the DATA trustworthy?           (migration 0013)
--   priority (P0-P3)   Should someone be emailed NOW?     (notification engine)
--   interest_score     Is this worth studying?            (this migration)
--
-- They genuinely diverge. A well-measured GRB — the three thousandth of its
-- kind — is high quality and low interest. A nearby binary-neutron-star merger
-- with a poor skymap is moderate quality and enormous interest.
--
-- research_interest stores every rule's contribution and rationale, plus the
-- list of quantities that could NOT be assessed — so a low score is
-- distinguishable from an unmeasured one.
--
-- Idempotent: safe to re-run.

ALTER TABLE core.events
  ADD COLUMN IF NOT EXISTS research_interest jsonb,
  ADD COLUMN IF NOT EXISTS interest_score    smallint;

COMMENT ON COLUMN core.events.research_interest IS
  'Transparent research-interest assessment: per-rule contributions with '
  'rationales, plus the quantities that could not be assessed. A triage '
  'heuristic for ordering a queue — NOT a measured property of the event.';
COMMENT ON COLUMN core.events.interest_score IS
  '0-100 research interest, denormalised for sorting. Distinct from '
  'quality_score (data trustworthiness) and notification priority (urgency).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_interest_score_range') THEN
    ALTER TABLE core.events ADD CONSTRAINT chk_interest_score_range
      CHECK (interest_score IS NULL OR (interest_score >= 0 AND interest_score <= 100));
  END IF;
END $$;

-- Sorting the archive by scientific interest is the point of the column.
CREATE INDEX IF NOT EXISTS idx_events_interest_score
  ON core.events (interest_score DESC)
  WHERE interest_score IS NOT NULL;
