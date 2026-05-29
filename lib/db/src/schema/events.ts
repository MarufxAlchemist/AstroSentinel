import { pgTable, text, serial, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(), // GRB, GW, FRB
  observatory: text("observatory").notNull(),
  detectionTime: text("detection_time").notNull(), // ISO with microseconds
  ra: real("ra").notNull(),
  dec: real("dec").notNull(),
  errorRadius: real("error_radius").notNull(),
  snr: real("snr").notNull(),
  far: real("far").notNull(),
  fluence: real("fluence"),
  dm: real("dm"),
  galLat: real("gal_lat").notNull(),
  galLon: real("gal_lon").notNull(),
  sunDistance: real("sun_distance").notNull(),
  moonDistance: real("moon_distance").notNull(),
  latencyUs: integer("latency_us").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({ id: true, createdAt: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type AstroEvent = typeof eventsTable.$inferSelect;
