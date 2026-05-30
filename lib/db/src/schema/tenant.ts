import {
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  bigserial,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const tenantSchema = pgSchema("tenant");

// ─── tenant.labs ────────────────────────────────────────────────────────────

export const labs = tenantSchema.table("labs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  slug:            text("slug").notNull().unique(),
  name:            text("name").notNull(),
  plan:            text("plan").notNull().default("free"),
  maxUsers:        integer("max_users").notNull().default(5),
  maxEventsPerDay: integer("max_events_per_day").notNull().default(1000),
  settings:        jsonb("settings").notNull().$type<Record<string, unknown>>().default({}),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Lab = typeof labs.$inferSelect;
export type InsertLab = typeof labs.$inferInsert;

// ─── tenant.lab_members ─────────────────────────────────────────────────────

export const labMembers = tenantSchema.table("lab_members", {
  id:       bigserial("id", { mode: "bigint" }).primaryKey(),
  labId:    uuid("lab_id").notNull().references(() => labs.id, { onDelete: "cascade" }),
  userId:   uuid("user_id").notNull(),  // FK to identity.users enforced via migration
  role:     text("role").notNull().default("researcher"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LabMember = typeof labMembers.$inferSelect;
export type InsertLabMember = typeof labMembers.$inferInsert;

// ─── tenant.lab_invitations ─────────────────────────────────────────────────

export const labInvitations = tenantSchema.table("lab_invitations", {
  id:         uuid("id").primaryKey().defaultRandom(),
  labId:      uuid("lab_id").notNull().references(() => labs.id, { onDelete: "cascade" }),
  invitedBy:  uuid("invited_by").notNull(),  // FK to identity.users enforced via migration
  email:      text("email").notNull(),
  role:       text("role").notNull().default("researcher"),
  status:     text("status").notNull().default("pending"),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LabInvitation = typeof labInvitations.$inferSelect;
export type InsertLabInvitation = typeof labInvitations.$inferInsert;

// ─── Relations ───────────────────────────────────────────────────────────────

export const labsRelations = relations(labs, ({ many }) => ({
  members:     many(labMembers),
  invitations: many(labInvitations),
}));

export const labMembersRelations = relations(labMembers, ({ one }) => ({
  lab: one(labs, { fields: [labMembers.labId], references: [labs.id] }),
}));

export const labInvitationsRelations = relations(labInvitations, ({ one }) => ({
  lab: one(labs, { fields: [labInvitations.labId], references: [labs.id] }),
}));

