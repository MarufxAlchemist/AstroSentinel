import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, users as usersTable, labs, labMembers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, signToken, AuthPayload } from "../middlewares/auth.js";
import type { Request } from "express";

const router = Router();

// POST /auth/register
router.post("/auth/register", async (req, res) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  // First user gets admin role
  const allUsers = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  const role = allUsers.length === 0 ? "admin" : "researcher";

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ email: email.toLowerCase(), passwordHash, name: name ?? email.split("@")[0] ?? "Researcher" })
    .returning();

  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  // Find or create default lab
  let [defaultLab] = await db.select().from(labs).limit(1);
  if (!defaultLab) {
    [defaultLab] = await db.insert(labs).values({
      slug: "default",
      name: "Default Lab",
    }).returning();
  }

  if (defaultLab) {
    await db.insert(labMembers).values({
      labId: defaultLab.id,
      userId: user.id,
      role: role,
    });
  }

  const token = signToken({ userId: user.id, email: user.email, role: role });
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: role } });
});

// POST /auth/login
router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Get user's role from their lab membership
  const [member] = await db.select().from(labMembers).where(eq(labMembers.userId, user.id)).limit(1);
  const role = member ? member.role : "researcher";

  const token = signToken({ userId: user.id, email: user.email, role: role });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: role } });
});

// GET /auth/me
router.get("/auth/me", requireAuth, (req, res) => {
  const user = (req as Request & { user: AuthPayload }).user;
  res.json({ userId: user.userId, email: user.email, role: user.role });
});

export default router;
