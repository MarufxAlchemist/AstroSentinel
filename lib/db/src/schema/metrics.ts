import {
  pgSchema,
  bigserial,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { labs } from "./tenant.js";
import { events } from "./events.js";

export const metricsSchema = pgSchema("metrics");

// ─── metrics.event_metrics (TimescaleDB hypertable) ──────────────────────────
//
// After running migrations, convert to hypertable:
//   SELECT create_hypertable('metrics.event_metrics', 'recorded_at',
//     chunk_time_interval => INTERVAL '1 day');
//
// Compression policy (compress chunks older than 3 days):
//   SELECT add_compression_policy('metrics.event_metrics', INTERVAL '3 days');
//
// Retention policy (drop chunks older than 90 days):
//   SELECT add_retention_policy('metrics.event_metrics', INTERVAL '90 days');
//
// Continuous aggregate — event_rate_1h:
//   CREATE MATERIALIZED VIEW metrics.event_rate_1h
//   WITH (timescaledb.continuous) AS
//   SELECT time_bucket('1 hour', detected_at) AS bucket,
//          lab_id, event_type, COUNT(*) AS event_count
//   FROM core.events
//   GROUP BY 1, 2, 3;
//   SELECT add_continuous_aggregate_policy('metrics.event_rate_1h', ...);

export const eventMetrics = metricsSchema.table("event_metrics", {
  id:          bigserial("id", { mode: "bigint" }).primaryKey(),
  labId:       uuid("lab_id").notNull().references(() => labs.id),
  eventId:     bigserial("event_id", { mode: "bigint" }).notNull()
                 .references(() => events.id),
  stage:       text("stage").notNull(),
  durationUs:  bigserial("duration_us", { mode: "bigint" }).notNull(),
  success:     boolean("success").notNull().default(true),
  errorCode:   text("error_code"),
  metadata:    jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  recordedAt:  timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  // ^ TimescaleDB hypertable partition key
});

export type EventMetric = typeof eventMetrics.$inferSelect;
export type InsertEventMetric = typeof eventMetrics.$inferInsert;

// ─── Relations ───────────────────────────────────────────────────────────────

export const eventMetricsRelations = relations(eventMetrics, ({ one }) => ({
  lab:   one(labs, { fields: [eventMetrics.labId], references: [labs.id] }),
  event: one(events, { fields: [eventMetrics.eventId], references: [events.id] }),
}));
