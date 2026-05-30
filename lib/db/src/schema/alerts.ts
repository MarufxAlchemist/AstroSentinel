import {
  pgSchema,
  bigserial,
  uuid,
  text,
  boolean,
  smallint,
  integer,
  real,
  doublePrecision,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { labs } from "./tenant.js";
import { users } from "./identity.js";
import { events } from "./events.js";

export const alertsSchema = pgSchema("alerts");

// ─── alerts.alert_subscriptions ─────────────────────────────────────────────

export const alertSubscriptions = alertsSchema.table("alert_subscriptions", {
  id:               bigserial("id", { mode: "bigint" }).primaryKey(),
  labId:            uuid("lab_id").notNull().references(() => labs.id),
  userId:           uuid("user_id").notNull().references(() => users.id),
  name:             text("name").notNull(),
  eventTypes:       text("event_types").array().notNull().default([]),
  minSnr:           doublePrecision("min_snr"),
  maxFar:           doublePrecision("max_far"),
  minGalLat:        real("min_gal_lat"),
  maxErrorRadius:   real("max_error_radius"),
  observatories:    text("observatories").array().notNull().default([]),
  channel:          text("channel").notNull(),
  channelConfig:    jsonb("channel_config").notNull().$type<Record<string, unknown>>().default({}),
  throttleMinutes:  integer("throttle_minutes").notNull().default(0),
  isActive:         boolean("is_active").notNull().default(true),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AlertSubscription = typeof alertSubscriptions.$inferSelect;
export type InsertAlertSubscription = typeof alertSubscriptions.$inferInsert;

// ─── alerts.alerts (TimescaleDB hypertable) ──────────────────────────────────

export const alerts = alertsSchema.table("alerts", {
  id:              bigserial("id", { mode: "bigint" }).primaryKey(),
  labId:           uuid("lab_id").notNull().references(() => labs.id),
  eventId:         bigserial("event_id", { mode: "bigint" }).notNull()
                     .references(() => events.id),
  subscriptionId:  bigserial("subscription_id", { mode: "bigint" }).notNull()
                     .references(() => alertSubscriptions.id),
  channel:         text("channel").notNull(),
  status:          text("status").notNull().default("queued"),
  payload:         jsonb("payload").notNull().$type<Record<string, unknown>>(),
  responseCode:    integer("response_code"),
  errorMessage:    text("error_message"),
  retryCount:      smallint("retry_count").notNull().default(0),
  sentAt:          timestamp("sent_at", { withTimezone: true }),
  deliveredAt:     timestamp("delivered_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // ^ TimescaleDB hypertable partition key — defined via migration:
  //   SELECT create_hypertable('alerts.alerts', 'created_at', chunk_time_interval => INTERVAL '7 days');
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// ─── Relations ───────────────────────────────────────────────────────────────

export const alertSubscriptionsRelations = relations(alertSubscriptions, ({ one, many }) => ({
  lab:    one(labs, { fields: [alertSubscriptions.labId], references: [labs.id] }),
  user:   one(users, { fields: [alertSubscriptions.userId], references: [users.id] }),
  alerts: many(alerts),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  lab:          one(labs, { fields: [alerts.labId], references: [labs.id] }),
  event:        one(events, { fields: [alerts.eventId], references: [events.id] }),
  subscription: one(alertSubscriptions, { fields: [alerts.subscriptionId], references: [alertSubscriptions.id] }),
}));
