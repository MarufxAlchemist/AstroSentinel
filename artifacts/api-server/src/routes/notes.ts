import { Router } from "express";
import { db, eventAnnotations, eventsTable, labMembers, users } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth.js";
import type { Request } from "express";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNote(
  row: typeof eventAnnotations.$inferSelect,
  author: { name: string; email: string } | null
) {
  return {
    id: String(row.id),
    content: row.content,
    tags: row.tags,
    isPinned: row.isPinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: author
      ? { name: author.name, email: author.email }
      : { name: "Unknown", email: "" },
  };
}

// ─── GET /events/:eventId/notes ───────────────────────────────────────────────

router.get("/events/:eventId/notes", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const rawId = req.params.eventId;
  if (!rawId) { res.status(400).json({ error: "eventId is required" }); return; }

  const eventNumId = parseInt(rawId, 10);
  if (isNaN(eventNumId)) { res.status(400).json({ error: "eventId must be numeric" }); return; }

  // Resolve actor's lab
  const [actorMember] = await db
    .select()
    .from(labMembers)
    .where(eq(labMembers.userId, actor.userId as any))
    .limit(1);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  // Fetch top-level notes (no parent) for this event, not soft-deleted
  const notes = await db
    .select()
    .from(eventAnnotations)
    .where(
      and(
        eq(eventAnnotations.eventId, BigInt(eventNumId)),
        eq(eventAnnotations.labId, actorMember.labId),
        isNull(eventAnnotations.parentId),
        isNull(eventAnnotations.deletedAt)
      )
    )
    .orderBy(desc(eventAnnotations.isPinned), desc(eventAnnotations.createdAt));

  // Batch-load authors
  const userIds = [...new Set(notes.map((n) => n.userId))];
  const authorRows = userIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, userIds[0])) // handled below with find
    : [];

  // Build a full author map — fetch all matching users
  const authorsById: Record<string, { name: string; email: string }> = {};
  if (userIds.length) {
    const allAuthors = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users);
    for (const u of allAuthors) {
      authorsById[u.id] = { name: u.name, email: u.email };
    }
  }
  void authorRows; // unused shortcut rows

  res.json({
    notes: notes.map((n) => formatNote(n, authorsById[n.userId] ?? null)),
  });
});

// ─── POST /events/:eventId/notes ─────────────────────────────────────────────

router.post("/events/:eventId/notes", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const rawId = req.params.eventId;
  if (!rawId) { res.status(400).json({ error: "eventId is required" }); return; }

  const eventNumId = parseInt(rawId, 10);
  if (isNaN(eventNumId)) { res.status(400).json({ error: "eventId must be numeric" }); return; }

  const { content, tags } = req.body as { content?: string; tags?: string[] };
  if (!content || content.trim().length === 0) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (content.length > 10_000) {
    res.status(400).json({ error: "content exceeds maximum length of 10,000 characters" });
    return;
  }

  const [actorMember] = await db
    .select()
    .from(labMembers)
    .where(eq(labMembers.userId, actor.userId as any))
    .limit(1);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  // Verify event exists in this lab
  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.id, BigInt(eventNumId)),
        eq(eventsTable.labId, actorMember.labId)
      )
    )
    .limit(1);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const sanitizedTags = Array.isArray(tags)
    ? tags.filter((t) => typeof t === "string" && t.trim().length > 0).slice(0, 10)
    : [];

  const [note] = await db
    .insert(eventAnnotations)
    .values({
      labId: actorMember.labId,
      eventId: BigInt(eventNumId),
      userId: actor.userId as any,
      content: content.trim(),
      tags: sanitizedTags,
    })
    .returning();

  const [authorRow] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, actor.userId as any))
    .limit(1);

  res.status(201).json({ note: formatNote(note!, authorRow ?? null) });
});

// ─── DELETE /events/:eventId/notes/:noteId ───────────────────────────────────

router.delete("/events/:eventId/notes/:noteId", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const { eventId: rawEventId, noteId: rawNoteId } = req.params;

  const eventNumId = parseInt(rawEventId ?? "", 10);
  const noteNumId = parseInt(rawNoteId ?? "", 10);
  if (isNaN(eventNumId) || isNaN(noteNumId)) {
    res.status(400).json({ error: "Invalid eventId or noteId" });
    return;
  }

  const [note] = await db
    .select()
    .from(eventAnnotations)
    .where(
      and(
        eq(eventAnnotations.id, BigInt(noteNumId)),
        eq(eventAnnotations.eventId, BigInt(eventNumId)),
        isNull(eventAnnotations.deletedAt)
      )
    )
    .limit(1);

  if (!note) { res.status(404).json({ error: "Note not found" }); return; }

  // Only the author can delete their own note
  if (note.userId !== actor.userId) {
    res.status(403).json({ error: "Cannot delete another researcher's note" });
    return;
  }

  // Soft-delete
  await db
    .update(eventAnnotations)
    .set({ deletedAt: new Date() })
    .where(eq(eventAnnotations.id, BigInt(noteNumId)));

  res.json({ ok: true });
});

export default router;
