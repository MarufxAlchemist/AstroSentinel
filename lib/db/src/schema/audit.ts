import {
  pgSchema,
  bigserial,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { labs } from "./tenant.js";
import { users } from "./identity.js";

export const auditSchema = pgSchema("audit");

// ─── audit.audit_logs (TimescaleDB hypertable, append-only) ──────────────────
//
// After running migrations, convert to hypertable:
//   SELECT create_hypertable('audit.audit_logs', 'created_at',
//     chunk_time_interval => INTERVAL '30 days');
//
// Compression (compress chunks older than 7 days — logs are write-once):
//   SELECT add_compression_policy('audit.audit_logs', INTERVAL '7 days');
//
// Retention (keep for 7 years — regulatory requirement):
//   SELECT add_retention_policy('audit.audit_logs', INTERVAL '7 years');
//
// BRIN index for compact range index on append-only timestamp:
//   CREATE INDEX audit_logs_created_at_brin ON audit.audit_logs
//   USING brin (created_at) WITH (pages_per_range = 128);
//
// Row-Level Security:
//   ALTER TABLE audit.audit_logs ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY audit_lab_isolation ON audit.audit_logs
//   USING (lab_id = current_setting('app.current_lab_id', true)::uuid
//          OR lab_id IS NULL);

export const auditLogs = auditSchema.table("audit_logs", {
  id:          bigserial("id", { mode: "bigint" }).primaryKey(),
  labId:       uuid("lab_id"),   // NULL for platform-level actions
  userId:      uuid("user_id").references(() => users.id),
  apiKeyId:    uuid("api_key_id"),  // FK to identity.api_keys via migration
  action:      text("action").notNull(),
  entityType:  text("entity_type").notNull(),
  entityId:    text("entity_id").notNull(),
  beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
  afterState:  jsonb("after_state").$type<Record<string, unknown>>(),
  ipAddress:   text("ip_address"),
  userAgent:   text("user_agent"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // ^ TimescaleDB hypertable partition key
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// ─── Relations ───────────────────────────────────────────────────────────────

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  lab:  one(labs, { fields: [auditLogs.labId], references: [labs.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));
