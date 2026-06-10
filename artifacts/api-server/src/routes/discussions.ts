import { Router } from "express";
import { db, eventAnnotations, eventsTable, labMembers, users } from "@workspace/db";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth.js";
import type { Request } from "express";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AnnotationRow = typeof eventAnnotations.$inferSelect;
type AuthorMap = Record<string, { name: string; email: string }>;

function formatPost(row: AnnotationRow, authorsById: AuthorMap) {
  return {
    id: String(row.id),
    parentId: row.parentId !== null ? String(row.parentId) : null,
    content: row.content,
    isPinned: row.isPinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: authorsById[row.userId] ?? { name: "Unknown", email: "" },
    replies: [] as ReturnType<typeof formatPost>[],
  };
}

async function buildAuthorsById(rows: AnnotationRow[]): Promise<AuthorMap> {
  const userIds = [...new Set(rows.map((r) => r.userId))];
  if (!userIds.length) return {};
  const allUsers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users);
  const map: AuthorMap = {};
  for (const u of allUsers) {
    if (userIds.includes(u.id)) map[u.id] = { name: u.name, email: u.email };
  }
  return map;
}

async function resolveActorLab(actorUserId: string) {
  const [member] = await db
    .select()
    .from(labMembers)
    .where(eq(labMembers.userId, actorUserId as any))
    .limit(1);
  return member ?? null;
}

function parseIntParam(val: string | undefined): number | null {
  const n = parseInt(val ?? "", 10);
  return isNaN(n) ? null : n;
}

// ─── GET /events/:eventId/discussions ────────────────────────────────────────
// Returns threads (parentId IS NULL with annotation type "discussion") plus
// their replies (parentId NOT NULL) in one response.
// We distinguish discussions from notes: discussions have parentId as their
// root marker. Since both share the table, we fetch:
//   • Root posts:  parentId IS NULL, stored as discussions by convention
//     (the POST endpoint below tags them — we fetch all parentId IS NULL rows
//      that are NOT already returned by the notes endpoint, which also queries
//      parentId IS NULL. To avoid overlap we use a tags filter: root discussion
//      rows always carry the tag "__discussion__".)
//   • Replies: parentId IS NOT NULL referencing a root discussion.
// This avoids any schema change.

router.get("/events/:eventId/discussions", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const eventNumId = parseIntParam(req.params.eventId);
  if (eventNumId === null) { res.status(400).json({ error: "eventId must be numeric" }); return; }

  const actorMember = await resolveActorLab(actor.userId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  // Fetch all non-deleted annotations for this event scoped to the lab
  const allRows = await db
    .select()
    .from(eventAnnotations)
    .where(
      and(
        eq(eventAnnotations.eventId, BigInt(eventNumId)),
        eq(eventAnnotations.labId, actorMember.labId),
        isNull(eventAnnotations.deletedAt)
      )
    )
    .orderBy(desc(eventAnnotations.isPinned), desc(eventAnnotations.createdAt));

  // Split: root discussion posts have the "__discussion__" tag
  const roots = allRows.filter(
    (r) => r.parentId === null && r.tags.includes("__discussion__")
  );
  const repliesAll = allRows.filter((r) => r.parentId !== null);

  const authorsById = await buildAuthorsById([...roots, ...repliesAll]);

  // Build thread tree
  const rootById = new Map<string, ReturnType<typeof formatPost>>();
  for (const r of roots) {
    rootById.set(String(r.id), formatPost(r, authorsById));
  }
  for (const reply of repliesAll) {
    const parentKey = String(reply.parentId);
    if (rootById.has(parentKey)) {
      rootById.get(parentKey)!.replies.push(formatPost(reply, authorsById));
    }
  }

  // Stable sort: replies within each thread oldest-first
  const threads = [...rootById.values()].map((t) => ({
    ...t,
    replies: t.replies.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ),
  }));

  res.json({ threads });
});

// ─── POST /events/:eventId/discussions ───────────────────────────────────────
// Creates a new root discussion thread.

router.post("/events/:eventId/discussions", requireAuth, async (req, res) => {
  const actor = (req as Request & { user: AuthPayload }).user;
  const eventNumId = parseIntParam(req.params.eventId);
  if (eventNumId === null) { res.status(400).json({ error: "eventId must be numeric" }); return; }

  const { content } = req.body as { content?: string };
  if (!content || content.trim().length === 0) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (content.length > 10_000) {
    res.status(400).json({ error: "content exceeds 10,000 characters" });
    return;
  }

  const actorMember = await resolveActorLab(actor.userId as string);
  if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(and(eq(eventsTable.id, BigInt(eventNumId)), eq(eventsTable.labId, actorMember.labId)))
    .limit(1);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const [row] = await db
    .insert(eventAnnotations)
    .values({
      labId: actorMember.labId,
      eventId: BigInt(eventNumId),
      userId: actor.userId as any,
      content: content.trim(),
      tags: ["__discussion__"],
      parentId: null as any,
    })
    .returning();

  const [authorRow] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, actor.userId as any))
    .limit(1);

  const authorsById: AuthorMap = {};
  if (authorRow) authorsById[actor.userId as string] = authorRow;

  res.status(201).json({ thread: { ...formatPost(row!, authorsById), replies: [] } });
});

// ─── POST /events/:eventId/discussions/:threadId/replies ─────────────────────
// Adds a reply to an existing thread.

router.post(
  "/events/:eventId/discussions/:threadId/replies",
  requireAuth,
  async (req, res) => {
    const actor = (req as Request & { user: AuthPayload }).user;
    const eventNumId = parseIntParam(req.params.eventId);
    const threadNumId = parseIntParam(req.params.threadId);
    if (eventNumId === null || threadNumId === null) {
      res.status(400).json({ error: "Invalid eventId or threadId" });
      return;
    }

    const { content } = req.body as { content?: string };
    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    if (content.length > 5_000) {
      res.status(400).json({ error: "reply exceeds 5,000 characters" });
      return;
    }

    const actorMember = await resolveActorLab(actor.userId as string);
    if (!actorMember) { res.status(403).json({ error: "Not a lab member" }); return; }

    // Verify the parent thread exists, belongs to this event/lab, is not deleted
    const [thread] = await db
      .select()
      .from(eventAnnotations)
      .where(
        and(
          eq(eventAnnotations.id, BigInt(threadNumId)),
          eq(eventAnnotations.eventId, BigInt(eventNumId)),
          eq(eventAnnotations.labId, actorMember.labId),
          isNull(eventAnnotations.parentId),
          isNull(eventAnnotations.deletedAt)
        )
      )
      .limit(1);
    if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

    const [reply] = await db
      .insert(eventAnnotations)
      .values({
        labId: actorMember.labId,
        eventId: BigInt(eventNumId),
        userId: actor.userId as any,
        content: content.trim(),
        tags: [],
        parentId: BigInt(threadNumId),
      })
      .returning();

    const [authorRow] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, actor.userId as any))
      .limit(1);

    const authorsById: AuthorMap = {};
    if (authorRow) authorsById[actor.userId as string] = authorRow;

    res.status(201).json({ reply: formatPost(reply!, authorsById) });
  }
);

// ─── DELETE /events/:eventId/discussions/:threadId ───────────────────────────
// Soft-deletes a root thread (author only). Replies remain but are hidden via
// the parent being deleted.

router.delete(
  "/events/:eventId/discussions/:threadId",
  requireAuth,
  async (req, res) => {
    const actor = (req as Request & { user: AuthPayload }).user;
    const eventNumId = parseIntParam(req.params.eventId);
    const threadNumId = parseIntParam(req.params.threadId);
    if (eventNumId === null || threadNumId === null) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }

    const [thread] = await db
      .select()
      .from(eventAnnotations)
      .where(
        and(
          eq(eventAnnotations.id, BigInt(threadNumId)),
          eq(eventAnnotations.eventId, BigInt(eventNumId)),
          isNull(eventAnnotations.deletedAt)
        )
      )
      .limit(1);
    if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

    if (thread.userId !== actor.userId) {
      res.status(403).json({ error: "Cannot delete another researcher's thread" });
      return;
    }

    await db
      .update(eventAnnotations)
      .set({ deletedAt: new Date() })
      .where(eq(eventAnnotations.id, BigInt(threadNumId)));

    res.json({ ok: true });
  }
);

export default router;
