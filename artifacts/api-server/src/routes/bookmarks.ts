import { Router } from "express";
import { db, eventBookmarks, eventsTable, labMembers, users } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth.js";
import type { Request } from "express";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BookmarkRow = typeof eventBookmarks.$inferSelect;
type EventRow    = typeof eventsTable.$inferSelect;
type UserRow     = { id: string; name: string; email: string };

function formatBookmark(bm: BookmarkRow, event: EventRow | null) {
  return {
    id:      String(bm.id),
    eventId: String(bm.eventId),
    note:    bm.note ?? null,
    createdAt: bm.createdAt.toISOString(),
    event: event
      ? {
          id:            String(event.id),
          eventId:       event.eventId,
          eventType:     event.eventType,
          detectionTime: event.detectionTime.toISOString(),
          ra:            event.ra,
          dec:           event.dec,
          snr:           event.snr,
          far:           event.far,
          status:        event.status,
          createdAt:     event.createdAt.toISOString(),
        }
      : null,
  };
}

async function resolveActorLab(userId: string) {
  const [m] = await db
    .select()
    .from(labMembers)
    .where(eq(labMembers.userId, userId as any))
    .limit(1);
  return m ?? null;
}

// ─── GET /bookmarks ───────────────────────────────────────────────────────────
// Returns all bookmarks for the authenticated researcher, newest first.

router.get("/bookmarks", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;

  const actorMember = await resolveActorLab(actor.userId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  const bms = await db
    .select()
    .from(eventBookmarks)
    .where(
      and(
        eq(eventBookmarks.userId, actor.userId as any),
        eq(eventBookmarks.labId, actorMember.labId)
      )
    )
    .orderBy(desc(eventBookmarks.createdAt));

  // Batch-load events
  const eventIds = [...new Set(bms.map((b) => b.eventId))];
  const eventsById: Record<string, EventRow> = {};

  if (eventIds.length) {
    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.labId, actorMember.labId));
    for (const r of rows) {
      eventsById[String(r.id)] = r;
    }
  }

  res.json({
    bookmarks: bms.map((b) => formatBookmark(b, eventsById[String(b.eventId)] ?? null)),
  });
});

// ─── POST /events/:eventId/bookmark ──────────────────────────────────────────
// Bookmark an event. Idempotent — returns existing bookmark if already bookmarked.

router.post("/events/:eventId/bookmark", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const rawId = req.params.eventId;
  const eventNumId = parseInt(rawId ?? "", 10);
  if (isNaN(eventNumId)) { res.status(400).json({ error: "eventId must be numeric" }); return; }

  const { note } = (req.body ?? {}) as { note?: string };

  const actorMember = await resolveActorLab(actor.userId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  // Verify event belongs to this lab
  const [event] = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.id, BigInt(eventNumId)),
        eq(eventsTable.labId, actorMember.labId)
      )
    )
    .limit(1);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  // Check if already bookmarked
  const [existing] = await db
    .select()
    .from(eventBookmarks)
    .where(
      and(
        eq(eventBookmarks.userId, actor.userId as any),
        eq(eventBookmarks.eventId, BigInt(eventNumId))
      )
    )
    .limit(1);

  if (existing) {
    res.status(200).json({ bookmark: formatBookmark(existing, event), alreadyExists: true });
    return;
  }

  const [bm] = await db
    .insert(eventBookmarks)
    .values({
      userId:  actor.userId as any,
      labId:   actorMember.labId,
      eventId: BigInt(eventNumId),
      note:    note?.trim() || null,
    })
    .returning();

  res.status(201).json({ bookmark: formatBookmark(bm!, event) });
});

// ─── DELETE /events/:eventId/bookmark ────────────────────────────────────────
// Remove bookmark for the authenticated researcher.

router.delete("/events/:eventId/bookmark", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const rawId = req.params.eventId;
  const eventNumId = parseInt(rawId ?? "", 10);
  if (isNaN(eventNumId)) { res.status(400).json({ error: "eventId must be numeric" }); return; }

  const [deleted] = await db
    .delete(eventBookmarks)
    .where(
      and(
        eq(eventBookmarks.userId, actor.userId as any),
        eq(eventBookmarks.eventId, BigInt(eventNumId))
      )
    )
    .returning();

  if (!deleted) { res.status(404).json({ error: "Bookmark not found" }); return; }
  res.json({ ok: true });
});

// ─── GET /events/:eventId/bookmark ───────────────────────────────────────────
// Check if current researcher has bookmarked this event.

router.get("/events/:eventId/bookmark", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const rawId = req.params.eventId;
  const eventNumId = parseInt(rawId ?? "", 10);
  if (isNaN(eventNumId)) { res.status(400).json({ error: "eventId must be numeric" }); return; }

  const [bm] = await db
    .select()
    .from(eventBookmarks)
    .where(
      and(
        eq(eventBookmarks.userId, actor.userId as any),
        eq(eventBookmarks.eventId, BigInt(eventNumId))
      )
    )
    .limit(1);

  res.json({ bookmarked: !!bm, bookmarkId: bm ? String(bm.id) : null });
});

export default router;
