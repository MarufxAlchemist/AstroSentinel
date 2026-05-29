import { Router } from "express";
import { db, teamMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, AuthPayload } from "../middlewares/auth.js";
import type { Request } from "express";

const router = Router();

// GET /team — any authenticated researcher
router.get("/team", requireAuth, async (_req, res) => {
  const members = await db.select().from(teamMembersTable).orderBy(teamMembersTable.createdAt);
  res.json({ members });
});

// POST /team — admin only
router.post("/team", requireAdmin, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const { email, name, role } = req.body as { email?: string; name?: string; role?: string };
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }
  const validRole = role === "admin" ? "admin" : "researcher";
  const existing = await db.select().from(teamMembersTable).where(eq(teamMembersTable.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Member already on team" });
    return;
  }
  const [member] = await db
    .insert(teamMembersTable)
    .values({ email: email.toLowerCase(), name: name ?? email.split("@")[0] ?? "", role: validRole, addedBy: actor.userId })
    .returning();
  res.status(201).json({ member });
});

// DELETE /team/:id — admin only
router.delete("/team/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db.delete(teamMembersTable).where(eq(teamMembersTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
