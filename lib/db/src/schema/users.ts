import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default("Researcher"),
  role: text("role").notNull().default("researcher"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("researcher"),
  addedBy: integer("added_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof usersTable.$inferSelect;
export type TeamMember = typeof teamMembersTable.$inferSelect;
