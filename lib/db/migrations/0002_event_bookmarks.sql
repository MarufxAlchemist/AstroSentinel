-- tenant.event_bookmarks
-- One bookmark per (user, event) pair — unique constraint prevents duplicates.
-- Cross-schema FKs enforced here (Drizzle DSL cannot express cross-schema references).

CREATE TABLE IF NOT EXISTS tenant.event_bookmarks (
  id         bigserial PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  lab_id     uuid        NOT NULL REFERENCES tenant.labs(id)    ON DELETE CASCADE,
  event_id   bigint      NOT NULL REFERENCES core.events(id)    ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_bookmarks_user_event UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_bookmarks_user_id  ON tenant.event_bookmarks (user_id);
CREATE INDEX IF NOT EXISTS idx_event_bookmarks_lab_id   ON tenant.event_bookmarks (lab_id);
CREATE INDEX IF NOT EXISTS idx_event_bookmarks_event_id ON tenant.event_bookmarks (event_id);
