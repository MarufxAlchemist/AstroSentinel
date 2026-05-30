import {
  pgSchema,
  bigserial,
  text,
  boolean,
  real,
  doublePrecision,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const catalogSchema = pgSchema("catalog");

// ─── catalog.observatories ──────────────────────────────────────────────────

export const observatories = catalogSchema.table("observatories", {
  id:          bigserial("id", { mode: "bigint" }).primaryKey(),
  code:        text("code").notNull().unique(),
  name:        text("name").notNull(),
  eventTypes:  text("event_types").array().notNull().default([]),
  network:     text("network"),
  country:     text("country"),
  latitude:    doublePrecision("latitude"),
  longitude:   doublePrecision("longitude"),
  altitudeM:   real("altitude_m"),
  websiteUrl:  text("website_url"),
  gcnTopic:    text("gcn_topic"),
  isActive:    boolean("is_active").notNull().default(true),
  metadata:    jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Observatory = typeof observatories.$inferSelect;
export type InsertObservatory = typeof observatories.$inferInsert;

// ─── catalog.observatory_capabilities ──────────────────────────────────────

export const observatoryCapabilities = catalogSchema.table("observatory_capabilities", {
  id:              bigserial("id", { mode: "bigint" }).primaryKey(),
  observatoryId:   bigserial("observatory_id", { mode: "bigint" }).notNull()
                     .references(() => observatories.id),
  instrument:      text("instrument").notNull(),
  band:            text("band"),
  frequencyMinHz:  doublePrecision("frequency_min_hz"),
  frequencyMaxHz:  doublePrecision("frequency_max_hz"),
  fovDeg2:         real("fov_deg2"),
  sensitivity:     doublePrecision("sensitivity"),
  metadata:        jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
});

export type ObservatoryCapability = typeof observatoryCapabilities.$inferSelect;
export type InsertObservatoryCapability = typeof observatoryCapabilities.$inferInsert;

// ─── catalog.sky_regions ────────────────────────────────────────────────────

export const skyRegions = catalogSchema.table("sky_regions", {
  id:         bigserial("id", { mode: "bigint" }).primaryKey(),
  name:       text("name").notNull(),
  type:       text("type").notNull(),
  raCenter:   doublePrecision("ra_center").notNull(),
  decCenter:  doublePrecision("dec_center").notNull(),
  radiusDeg:  real("radius_deg"),
  // footprint geography(POLYGON, 4326) handled via raw migration (PostGIS type)
  metadata:   jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SkyRegion = typeof skyRegions.$inferSelect;
export type InsertSkyRegion = typeof skyRegions.$inferInsert;

// ─── Relations ───────────────────────────────────────────────────────────────

export const observatoriesRelations = relations(observatories, ({ many }) => ({
  capabilities: many(observatoryCapabilities),
}));

export const observatoryCapabilitiesRelations = relations(observatoryCapabilities, ({ one }) => ({
  observatory: one(observatories, {
    fields: [observatoryCapabilities.observatoryId],
    references: [observatories.id],
  }),
}));
