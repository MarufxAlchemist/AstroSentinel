import { Router } from "express";
import { db, eventsTable } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { ListEventsQueryParams, GetEventParams } from "@workspace/api-zod";

const router = Router();

function formatEvent(row: typeof eventsTable.$inferSelect) {
  return {
    // id and latencyUs are BigInt because of bigserial({ mode: "bigint" })
    id: String(row.id),
    eventId: row.eventId,
    eventType: row.eventType,
    observatory: "Unknown",
    detectionTime: row.detectionTime.toISOString(),
    ra: row.ra,
    dec: row.dec,
    errorRadius: row.errorRadius,
    snr: row.snr,
    far: row.far,
    fluence: row.fluence ?? undefined,
    dm: row.dm ?? undefined,
    t90: row.t90 ?? undefined,
    peakFlux: row.peakFlux ?? undefined,
    chirpMass: row.chirpMass ?? undefined,
    luminosityDistance: row.luminosityDistance ?? undefined,
    galLat: row.galLat,
    galLon: row.galLon,
    sunDistance: row.sunDistance,
    moonDistance: row.moonDistance,
    latencyUs: String(row.latencyUs),
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /events
router.get("/events", async (req, res) => {
  const parsed = ListEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const { limit = 50, offset = 0, eventType } = parsed.data;

  const conditions = [];
  if (eventType) conditions.push(eq(eventsTable.eventType, eventType));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [events, countResult] = await Promise.all([
    db
      .select()
      .from(eventsTable)
      .where(whereClause)
      .orderBy(desc(eventsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .where(whereClause),
  ]);

  res.json({
    events: events.map(formatEvent),
    total: Number(countResult[0]?.count ?? 0),
  });
});

// GET /events/stats
router.get("/events/stats", async (req, res) => {
  const [totalResult, byTypeResult, recentResult, latestResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(eventsTable),
    db
      .select({ eventType: eventsTable.eventType, count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .groupBy(eventsTable.eventType),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .where(sql`created_at > now() - interval '1 hour'`),
    db.select().from(eventsTable).orderBy(desc(eventsTable.createdAt)).limit(1),
  ]);

  const byType = { GRB: 0, GW: 0, FRB: 0 };
  for (const row of byTypeResult) {
    if (row.eventType in byType) {
      byType[row.eventType as keyof typeof byType] = Number(row.count);
    }
  }

  res.json({
    totalEvents: Number(totalResult[0]?.count ?? 0),
    byType,
    byObservatory: [], // observatory column was removed
    recentRate: Number(recentResult[0]?.count ?? 0),
    latestEvent: latestResult[0] ? formatEvent(latestResult[0]) : null,
  });
});

// GET /events/:id
router.get("/events/:id", async (req, res) => {
  const parsed = GetEventParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const id = parseInt(parsed.data.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID must be numeric" });
    return;
  }

  const [row] = await db.select().from(eventsTable).where(eq(eventsTable.id, BigInt(id))).limit(1);

  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  res.json(formatEvent(row));
});

export default router;
