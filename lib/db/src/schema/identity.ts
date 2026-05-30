import {
  pgSchema,
  uuid,
  text,
  boolean,
  bigserial,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const identitySchema = pgSchema("identity");

// ─── identity.users ─────────────────────────────────────────────────────────

export const users = identitySchema.table("users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name:         text("name").notNull(),
  avatarUrl:    text("avatar_url"),
  orcidId:      text("orcid_id"),
  isVerified:   boolean("is_verified").notNull().default(false),
  isSystem:     boolean("is_system").notNull().default(false),
  lastLoginAt:  timestamp("last_login_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── identity.sessions ──────────────────────────────────────────────────────

export const sessions = identitySchema.table("sessions", {
  id:               uuid("id").primaryKey().defaultRandom(),
  userId:           uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  userAgent:        text("user_agent"),
  ipAddress:        text("ip_address"),  // stored as TEXT; INET enforced at DB level via migration
  expiresAt:        timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt:        timestamp("revoked_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

// ─── identity.api_keys ──────────────────────────────────────────────────────

export const apiKeys = identitySchema.table("api_keys", {
  id:          uuid("id").primaryKey().defaultRandom(),
  labId:       uuid("lab_id").notNull(),  // FK to tenant.labs enforced via migration
  createdBy:   uuid("created_by").notNull().references(() => users.id),
  name:        text("name").notNull(),
  keyHash:     text("key_hash").notNull().unique(),
  keyPrefix:   text("key_prefix").notNull(),
  scopes:      text("scopes").array().notNull().default([]),
  lastUsedAt:  timestamp("last_used_at", { withTimezone: true }),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
  revokedAt:   timestamp("revoked_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ─── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  apiKeys:  many(apiKeys),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  createdByUser: one(users, { fields: [apiKeys.createdBy], references: [users.id] }),
}));
