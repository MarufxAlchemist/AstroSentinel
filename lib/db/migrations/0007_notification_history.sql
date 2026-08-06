-- Migration: 0007_notification_history.sql
-- Phase 5.5 — Intelligent Notification Deduplication Engine
--
-- Creates alerts.notification_history:
--   Append-only audit table for all deduplication decisions.
--   One row per decision (send OR suppress) per GCN lifecycle revision.
--
-- Design notes:
--   · event_id is the GCN string identifier (e.g. "S230518h"), NOT the
--     internal core.events bigserial primary key. This allows the dedup engine
--     to operate without a DB join on every Kafka message.
--   · suppressed = TRUE records are kept for complete audit trail.
--   · The composite index on (event_id, sent_at DESC) supports the
--     getLastNotification() query which reads ONLY the most-recent sent row.
--   · BRIN index on sent_at for time-range scans on large tables.

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alerts.notification_history (
    id              BIGSERIAL PRIMARY KEY,
    event_id        TEXT             NOT NULL,
    lifecycle       TEXT             NOT NULL,
    revision_count  INTEGER          NOT NULL DEFAULT 0,
    priority_level  TEXT             NOT NULL,
    priority_score  INTEGER          NOT NULL DEFAULT 0,
    corr_confidence TEXT             NOT NULL DEFAULT 'NONE',
    error_radius    DOUBLE PRECISION NOT NULL DEFAULT 0,
    trigger_reasons TEXT[]           NOT NULL DEFAULT '{}',
    suppressed      BOOLEAN          NOT NULL DEFAULT FALSE,
    sent_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Composite index for getLastNotification(eventId) query
CREATE INDEX IF NOT EXISTS notification_history_event_id_sent_at_idx
    ON alerts.notification_history (event_id, sent_at DESC);

-- BRIN index for time-range scans (very cheap on append-only table)
CREATE INDEX IF NOT EXISTS notification_history_sent_at_brin
    ON alerts.notification_history
    USING BRIN (sent_at)
    WITH (pages_per_range = 64);

-- Comment for documentation
COMMENT ON TABLE alerts.notification_history IS
    'Phase 5.5 deduplication audit log. One row per GCN revision decision. '
    'suppressed=TRUE means the revision was seen but no email was sent. '
    'suppressed=FALSE means email was dispatched.';

COMMENT ON COLUMN alerts.notification_history.event_id IS
    'GCN string event identifier (e.g. S230518h). Not the internal bigserial PK.';

COMMENT ON COLUMN alerts.notification_history.trigger_reasons IS
    'Human-readable reasons for send or suppress decision. '
    'Example: ["First notification", "Priority increased P1→P0"]';
