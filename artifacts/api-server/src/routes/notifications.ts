import { Router } from "express";
import { db, alertSubscriptions, labMembers, users } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth.js";
import { NotificationPreferencesSchema } from "@workspace/api-zod";
import type { Request } from "express";

const router = Router();

async function resolveActorLab(userId: string) {
  const [m] = await db
    .select()
    .from(labMembers)
    .where(eq(labMembers.userId, userId as any))
    .limit(1);
  return m ?? null;
}

// ─── GET /notifications/preferences ──────────────────────────────────────────
router.get("/notifications/preferences", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const actorUserId = actor.userId || (actor as any).id;
  const actorMember = await resolveActorLab(actorUserId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  const [sub] = await db
    .select()
    .from(alertSubscriptions)
    .where(
      and(
        eq(alertSubscriptions.userId, actorUserId as any),
        eq(alertSubscriptions.labId, actorMember.labId)
      )
    )
    .limit(1);

  if (!sub) {
    // Return empty state matching the schema
    const defaultPrefs = {
      email: actor.email || "",
      channels: ["email"],
      eventTypes: ["GRB", "GW", "FRB", "Neutrinos", "Einstein Probe"],
      priorityLevel: "all",
      observatories: ["Swift BAT", "Fermi GBM", "Einstein Probe", "LIGO/Virgo/KAGRA", "IceCube", "CHIME"],
      behaviour: {
        aiSummary: true,
        correlation: true,
        localization: true,
        digest: false,
        instant: true
      }
    };
    res.json(defaultPrefs);
    return;
  }

  res.json({
    email: (sub.channelConfig as any).email || actor.email || "",
    channels: sub.isActive ? [sub.channel] : [], // Assuming channel = 'email'
    eventTypes: sub.eventTypes,
    priorityLevel: sub.priorityLevel,
    observatories: sub.observatories,
    behaviour: sub.behaviour,
    isActive: sub.isActive,
  });
});

async function handleSavePreferences(req: Request, res: any) {
  const actor = (req as Request & { user: AuthPayload }).user;
  const actorUserId = actor.userId || (actor as any).id;
  const actorMember = await resolveActorLab(actorUserId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  const parsed = NotificationPreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const prefs = parsed.data;

  // Check if subscription exists
  const [existing] = await db
    .select()
    .from(alertSubscriptions)
    .where(
      and(
        eq(alertSubscriptions.userId, actorUserId as any),
        eq(alertSubscriptions.labId, actorMember.labId)
      )
    )
    .limit(1);

  const isActive = prefs.channels.includes("email");

  if (existing) {
    const [updated] = await db
      .update(alertSubscriptions)
      .set({
        channel: "email",
        channelConfig: { email: prefs.email },
        eventTypes: prefs.eventTypes,
        priorityLevel: prefs.priorityLevel,
        observatories: prefs.observatories,
        behaviour: prefs.behaviour,
        isActive: isActive,
        updatedAt: new Date(),
      })
      .where(eq(alertSubscriptions.id, existing.id))
      .returning();
    res.json({ ...updated, id: updated.id.toString() });
  } else {
    const [created] = await db
      .insert(alertSubscriptions)
      .values({
        userId: actorUserId as any,
        labId: actorMember.labId,
        name: "Default Subscription",
        channel: "email",
        channelConfig: { email: prefs.email },
        eventTypes: prefs.eventTypes,
        priorityLevel: prefs.priorityLevel,
        observatories: prefs.observatories,
        behaviour: prefs.behaviour,
        isActive: isActive,
      })
      .returning();
    res.json({ ...created, id: created.id.toString() });
  }
}

// ─── POST /notifications/preferences ─────────────────────────────────────────
router.post("/notifications/preferences", requireAuth, handleSavePreferences);

// ─── PATCH /notifications/preferences ────────────────────────────────────────
router.patch("/notifications/preferences", requireAuth, handleSavePreferences);

// ─── DELETE /notifications/preferences ───────────────────────────────────────
router.delete("/notifications/preferences", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const actorUserId = actor.userId || (actor as any).id;
  const actorMember = await resolveActorLab(actorUserId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  const [deleted] = await db
    .delete(alertSubscriptions)
    .where(
      and(
        eq(alertSubscriptions.userId, actorUserId as any),
        eq(alertSubscriptions.labId, actorMember.labId)
      )
    )
    .returning();

  if (!deleted) { res.status(404).json({ error: "Subscription not found" }); return; }
  res.json({ ok: true });
});

// ─── POST /notifications/preferences/toggle ──────────────────────────────────
router.post("/notifications/preferences/toggle", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const actorUserId = actor.userId || (actor as any).id;
  const actorMember = await resolveActorLab(actorUserId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  const [existing] = await db
    .select()
    .from(alertSubscriptions)
    .where(
      and(
        eq(alertSubscriptions.userId, actorUserId as any),
        eq(alertSubscriptions.labId, actorMember.labId)
      )
    )
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Subscription not found. Save preferences first." }); return; }

  const [updated] = await db
    .update(alertSubscriptions)
    .set({ isActive: !existing.isActive, updatedAt: new Date() })
    .where(eq(alertSubscriptions.id, existing.id))
    .returning();

  res.json({ ...updated, id: updated.id.toString() });
});

export default router;
