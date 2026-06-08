import { Router } from "express";
import { db, labMembers, users, labs } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin, AuthPayload } from "../middlewares/auth.js";
import type { Request } from "express";
import crypto from "crypto";

const router = Router();

// GET /team — any authenticated researcher
router.get("/team", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  
  // Get actor's lab (assuming first lab for simplicity, or should join)
  const [actorMember] = await db.select().from(labMembers).where(eq(labMembers.userId, actor.userId as any)).limit(1);
  if (!actorMember) {
    res.json({ members: [] });
    return;
  }

  const members = await db
    .select({
      id: labMembers.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: labMembers.role,
      createdAt: labMembers.joinedAt,
    })
    .from(labMembers)
    .innerJoin(users, eq(labMembers.userId, users.id))
    .where(eq(labMembers.labId, actorMember.labId))
    .orderBy(labMembers.joinedAt);

  res.json({ members: members.map(m => ({
    ...m,
    id: String(m.id) // Convert BigInt to string for JSON serialization
  })) });
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
  
  const [actorMember] = await db.select().from(labMembers).where(eq(labMembers.userId, actor.userId as any)).limit(1);
  if (!actorMember) {
    res.status(403).json({ error: "Actor is not in a lab" });
    return;
  }

  const targetEmail = email.toLowerCase();
  
  // Find or create user
  let [targetUser] = await db.select().from(users).where(eq(users.email, targetEmail)).limit(1);
  if (!targetUser) {
    const randomPassword = crypto.randomBytes(16).toString("hex");
    [targetUser] = await db.insert(users).values({
      email: targetEmail,
      name: name ?? targetEmail.split("@")[0] ?? "Researcher",
      passwordHash: randomPassword,
    }).returning();
  }

  // Check if already in lab
  const existing = await db.select().from(labMembers)
    .where(and(eq(labMembers.userId, targetUser.id), eq(labMembers.labId, actorMember.labId)))
    .limit(1);
    
  if (existing.length > 0) {
    res.status(409).json({ error: "Member already on team" });
    return;
  }

  const [member] = await db
    .insert(labMembers)
    .values({
      labId: actorMember.labId,
      userId: targetUser.id,
      role: validRole,
    })
    .returning();

  res.status(201).json({ 
    member: {
      id: String(member.id),
      userId: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: member.role,
      createdAt: member.joinedAt
    } 
  });
});

// DELETE /team/:id — admin only
router.delete("/team/:id", requireAdmin, async (req, res) => {
  const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!idStr || typeof idStr !== "string") {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  
  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch (e) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }

  const [deleted] = await db.delete(labMembers).where(eq(labMembers.id, id as any)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
