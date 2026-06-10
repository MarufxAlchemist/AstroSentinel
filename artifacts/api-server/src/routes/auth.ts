import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, users as usersTable, labs, labMembers, labInvitations } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, signToken, AuthPayload } from "../middlewares/auth.js";
import type { Request } from "express";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const router = Router();

// POST /auth/google
router.post("/auth/google", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: "Google token is required" });
    return;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (e) {
    res.status(401).json({ error: "Invalid Google token" });
    return;
  }

  if (!payload || !payload.email) {
    res.status(400).json({ error: "Could not retrieve email from Google" });
    return;
  }

  const email = payload.email.toLowerCase();
  const name = payload.name || email.split("@")[0] || "Researcher";

  let [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  let role = "researcher";

  if (user) {
    // User exists, get role
    const [member] = await db.select().from(labMembers).where(eq(labMembers.userId, user.id)).limit(1);
    role = member ? member.role : "researcher";
  } else {
    // User does not exist, check registration rules
    const allUsers = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    const isFirstUser = allUsers.length === 0;
    let invitation = null;

    if (isFirstUser) {
      role = "admin";
    } else {
      const [pendingInvite] = await db.select().from(labInvitations)
        .where(and(eq(labInvitations.email, email), eq(labInvitations.status, "pending")))
        .limit(1);
      
      if (!pendingInvite || new Date() > pendingInvite.expiresAt) {
        res.status(403).json({ error: "Registration requires an invitation" });
        return;
      }
      invitation = pendingInvite;
      role = pendingInvite.role;
    }

    const randomPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash, name })
      .returning();

    if (!user) {
      res.status(500).json({ error: "Failed to create user" });
      return;
    }

    if (isFirstUser) {
      let [defaultLab] = await db.select().from(labs).limit(1);
      if (!defaultLab) {
        [defaultLab] = await db.insert(labs).values({ slug: "default", name: "Default Lab" }).returning();
      }
      if (defaultLab) {
        await db.insert(labMembers).values({ labId: defaultLab.id, userId: user.id, role });
      }
    } else if (invitation) {
      await db.insert(labMembers).values({ labId: invitation.labId, userId: user.id, role });
      await db.update(labInvitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(labInvitations.id, invitation.id));
    }
  }

  const jwtToken = signToken({ userId: user.id, email: user.email, role });
  res.json({ token: jwtToken, user: { id: user.id, email: user.email, name: user.name, role } });
});

// POST /auth/orcid
router.post("/auth/orcid", async (req, res) => {
  const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };
  if (!code || !redirectUri) {
    res.status(400).json({ error: "code and redirectUri are required" });
    return;
  }

  try {
    const tokenParams = new URLSearchParams({
      client_id: process.env.ORCID_CLIENT_ID || "",
      client_secret: process.env.ORCID_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch("https://orcid.org/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenRes.json() as any;
    
    if (!tokenRes.ok) {
      res.status(401).json({ error: "Failed to exchange ORCID token", details: tokenData });
      return;
    }

    const { id_token, orcid, name: orcidName } = tokenData;
    let email = "";
    
    if (id_token) {
      const decoded = jwt.decode(id_token) as any;
      if (decoded && decoded.email) {
        email = decoded.email.toLowerCase();
      }
    }

    const name = orcidName || (email ? email.split("@")[0] : "Researcher");
    let role = "researcher";
    
    // 1. Look up by ORCID
    let [user] = await db.select().from(usersTable).where(eq(usersTable.orcidId, orcid)).limit(1);

    if (user) {
      const [member] = await db.select().from(labMembers).where(eq(labMembers.userId, user.id)).limit(1);
      role = member ? member.role : "researcher";
    } else {
      // 2. Look up by Email
      if (email) {
        [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
        if (user) {
          // Link account
          [user] = await db.update(usersTable).set({ orcidId: orcid }).where(eq(usersTable.id, user.id)).returning();
          const [member] = await db.select().from(labMembers).where(eq(labMembers.userId, user.id)).limit(1);
          role = member ? member.role : "researcher";
        }
      }

      if (!user) {
        // User does not exist, follow registration logic
        if (!email) {
          res.status(400).json({ error: "ORCID did not provide an email address. Please make your email visible in ORCID or use email/password login." });
          return;
        }

        const allUsers = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
        const isFirstUser = allUsers.length === 0;
        let invitation = null;

        if (isFirstUser) {
          role = "admin";
        } else {
          const [pendingInvite] = await db.select().from(labInvitations)
            .where(and(eq(labInvitations.email, email), eq(labInvitations.status, "pending")))
            .limit(1);
          
          if (!pendingInvite || new Date() > pendingInvite.expiresAt) {
            res.status(403).json({ error: "Registration requires an invitation" });
            return;
          }
          invitation = pendingInvite;
          role = pendingInvite.role;
        }

        const randomPassword = crypto.randomBytes(32).toString("hex");
        const passwordHash = await bcrypt.hash(randomPassword, 12);

        [user] = await db
          .insert(usersTable)
          .values({ email, passwordHash, name, orcidId: orcid })
          .returning();

        if (!user) {
          res.status(500).json({ error: "Failed to create user" });
          return;
        }

        if (isFirstUser) {
          let [defaultLab] = await db.select().from(labs).limit(1);
          if (!defaultLab) {
            [defaultLab] = await db.insert(labs).values({ slug: "default", name: "Default Lab" }).returning();
          }
          if (defaultLab) {
            await db.insert(labMembers).values({ labId: defaultLab.id, userId: user.id, role });
          }
        } else if (invitation) {
          await db.insert(labMembers).values({ labId: invitation.labId, userId: user.id, role });
          await db.update(labInvitations)
            .set({ status: "accepted", acceptedAt: new Date() })
            .where(eq(labInvitations.id, invitation.id));
        }
      }
    }

    const jwtToken = signToken({ userId: user.id, email: user.email, role });
    res.json({ token: jwtToken, user: { id: user.id, email: user.email, name: user.name, role, orcidId: user.orcidId } });
  } catch (error) {
    console.error("ORCID auth error:", error);
    res.status(500).json({ error: "Internal server error during ORCID authentication" });
  }
});

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
  const isFirstUser = allUsers.length === 0;

  let invitation = null;
  let role = "researcher";

  if (isFirstUser) {
    role = "admin";
  } else {
    // Check for pending invitation
    const [pendingInvite] = await db.select().from(labInvitations)
      .where(and(eq(labInvitations.email, email.toLowerCase()), eq(labInvitations.status, "pending")))
      .limit(1);
    
    if (!pendingInvite) {
      res.status(403).json({ error: "Registration requires an invitation" });
      return;
    }
    
    if (new Date() > pendingInvite.expiresAt) {
      res.status(403).json({ error: "Invitation has expired" });
      return;
    }
    
    invitation = pendingInvite;
    role = pendingInvite.role;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ email: email.toLowerCase(), passwordHash, name: name ?? email.split("@")[0] ?? "Researcher" })
    .returning();

  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  if (isFirstUser) {
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
  } else if (invitation) {
    // Join lab from invitation
    await db.insert(labMembers).values({
      labId: invitation.labId,
      userId: user.id,
      role: invitation.role,
    });
    
    // Mark invitation accepted
    await db.update(labInvitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(labInvitations.id, invitation.id));
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
