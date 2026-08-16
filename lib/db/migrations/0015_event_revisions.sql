-- 0015_event_revisions.sql
-- Phase 6: revision intelligence and scientific delta detection.
-- Spec sections 27-28.
--
-- THE PROBLEM THIS FIXES
-- ----------------------
-- Revisions were applied by an UPSERT that overwrote core.events in place and
-- incremented revision_count. The previous scientific state was destroyed. If a
-- GW localization moved 40 degrees between the preliminary and updated notice,
-- nothing recorded that it had moved: the event simply *was* wherever the
-- latest notice put it, and a researcher who had already pointed a telescope at
-- the first position had no way to discover the change.
--
-- core.event_revisions is an APPEND-ONLY history. One row per notice received,
-- carrying the scientific snapshot at that moment plus the computed delta
-- against its predecessor. core.events keeps holding the current state, so
-- nothing downstream changes; this table adds the history that was missing.
--
-- Deliberately NOT a full payload archive: it stores what is needed to
-- reconstruct and compare revisions. The raw notice remains the source of
-- truth upstream.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS core.event_revisions (
  id              bigserial PRIMARY KEY,
  /* FK to the current-state row. ON DELETE CASCADE: history for a deleted
     event has nothing to describe. */
  event_pk        bigint NOT NULL REFERENCES core.events(id) ON DELETE CASCADE,
  /* The GCN string id, denormalised so history survives a re-keyed row and can
     be queried without a join. */
  event_id        text NOT NULL,
  /* 0 for the first notice, then monotonically increasing. */
  revision_index  integer NOT NULL,
  /* alert_type from the notice: PRELIMINARY | INITIAL | UPDATE | RETRACTION. */
  alert_type      text,
  lifecycle       text,
  is_retraction   boolean NOT NULL DEFAULT false,

  /* The scientific snapshot at this revision. Absent keys mean the notice did
     not report the quantity — the same UNKNOWN semantics as core.events. */
  snapshot        jsonb NOT NULL,

  /* The computed delta against the previous revision. NULL on the first
     notice, which has nothing to be compared against. */
  delta           jsonb,
  /* NONE | ROUTINE | NOTABLE | CRITICAL — denormalised for filtering. */
  significance    text,

  /* When this notice was processed. Distinct from the event's detection_time. */
  received_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.event_revisions IS
  'Append-only history of every notice received for an event, with the '
  'scientific delta against its predecessor. Rows are never updated or '
  'deleted except by cascade.';
COMMENT ON COLUMN core.event_revisions.snapshot IS
  'Scientific state as reported by this notice. A missing key is UNKNOWN.';
COMMENT ON COLUMN core.event_revisions.delta IS
  'Output of app.science.revisions.compare_revisions against the previous '
  'revision. NULL for the first notice.';
COMMENT ON COLUMN core.event_revisions.significance IS
  'NONE | ROUTINE | NOTABLE | CRITICAL. CRITICAL means a retraction, a '
  'messenger-type change, or a position inconsistent with its own error bars '
  '— not merely a low-quality event.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_revision_significance') THEN
    ALTER TABLE core.event_revisions ADD CONSTRAINT chk_revision_significance
      CHECK (significance IS NULL OR significance IN
             ('NONE', 'ROUTINE', 'NOTABLE', 'CRITICAL'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_revision_index_non_negative') THEN
    ALTER TABLE core.event_revisions ADD CONSTRAINT chk_revision_index_non_negative
      CHECK (revision_index >= 0);
  END IF;

  -- The first notice cannot have a delta; a later one always can.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_first_revision_has_no_delta') THEN
    ALTER TABLE core.event_revisions ADD CONSTRAINT chk_first_revision_has_no_delta
      CHECK (revision_index > 0 OR delta IS NULL);
  END IF;
END $$;

-- One row per (event, revision index): re-processing the same notice must not
-- silently duplicate history.
CREATE UNIQUE INDEX IF NOT EXISTS event_revisions_event_pk_index_uniq
  ON core.event_revisions (event_pk, revision_index);

-- The dominant query: the full history of one event, newest first.
CREATE INDEX IF NOT EXISTS event_revisions_event_id_received_idx
  ON core.event_revisions (event_id, received_at DESC);

-- Finding the scientifically material revisions across the archive.
CREATE INDEX IF NOT EXISTS event_revisions_significance_idx
  ON core.event_revisions (significance, received_at DESC)
  WHERE significance IN ('NOTABLE', 'CRITICAL');
