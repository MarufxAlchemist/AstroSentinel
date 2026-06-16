import { Router } from "express";
import { db, eventsTable, eventLocalizations } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { ListEventsQueryParams, GetEventParams } from "@workspace/api-zod";


const router = Router();

function formatEvent(row: typeof eventsTable.$inferSelect) {
  return {
    // id and latencyUs are BigInt because of bigserial({ mode: "bigint" })
    id: String(row.id),
    eventId: row.eventId,
    eventType: row.eventType,
    observatory: row.observatory ?? "Unknown",
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
    // Alert filtering metadata
    lifecycle: (row.lifecycle ?? "preliminary") as "preliminary" | "initial" | "update" | "confirmed",
    alertType: row.alertType ?? undefined,
    classificationTier: (row.classificationTier ?? undefined) as "GOLD" | "BRONZE" | undefined,
    isHistorical: row.isHistorical ?? false,
    source: row.source ?? "kafka",
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
      .orderBy(desc(eventsTable.detectionTime))
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
  const [totalResult, byTypeResult, byObservatoryResult, recentResult, latestResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(eventsTable),
    db
      .select({ eventType: eventsTable.eventType, count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .groupBy(eventsTable.eventType),
    db
      .select({ observatory: eventsTable.observatory, count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .groupBy(eventsTable.observatory)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .where(sql`created_at > now() - interval '1 hour'`),
    db.select().from(eventsTable).orderBy(desc(eventsTable.detectionTime)).limit(1),
  ]);

  // Build byType dynamically — includes every event type present in the DB
  const byType: Record<string, number> = {};
  for (const row of byTypeResult) {
    byType[row.eventType] = Number(row.count);
  }

  const byObservatory = byObservatoryResult.map((row) => ({
    observatory: row.observatory ?? "Unknown",
    count: Number(row.count),
  }));

  res.json({
    totalEvents: Number(totalResult[0]?.count ?? 0),
    byType,
    byObservatory,
    recentRate: Number(recentResult[0]?.count ?? 0),
    latestEvent: latestResult[0] ? formatEvent(latestResult[0]) : null,
  });
});

// GET /events/:id/localizations
// Must be registered BEFORE /events/:id so Express does not absorb
// "localizations" as the :id param value.
router.get("/events/:id/localizations", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "Invalid event ID — must be a positive integer" });
    return;
  }

  const eventId = BigInt(id);

  const rows = await db
    .select()
    .from(eventLocalizations)
    .where(eq(eventLocalizations.eventId, eventId))
    .orderBy(desc(eventLocalizations.version));

  const payload = rows.map((loc) => ({
    id:          String(loc.id),
    eventId:     String(loc.eventId),
    fitsUrl:     loc.fitsUrl,
    method:      loc.method,
    version:     loc.version,
    isLatest:    loc.isLatest,
    nside:       loc.nside       ?? undefined,
    area50Deg2:  loc.area50Deg2  ?? undefined,
    area90Deg2:  loc.area90Deg2  ?? undefined,
    vol50Mpc3:   loc.vol50Mpc3   ?? undefined,
    vol90Mpc3:   loc.vol90Mpc3   ?? undefined,
    hasNsProb:   loc.hasNsProb   ?? undefined,
    createdAt:   loc.createdAt.toISOString(),
  }));

  res.json(payload);
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

// GET /events/:id/correlations
router.get("/events/:id/correlations", async (req, res) => {
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

  const [targetEvent] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, BigInt(id)))
    .limit(1);

  if (!targetEvent) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  // Fetch candidate events in the same lab
  // Using a 7-day window
  const startWindow = new Date(targetEvent.detectionTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endWindow = new Date(targetEvent.detectionTime.getTime() + 7 * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.labId, targetEvent.labId),
        sql`${eventsTable.id} != ${targetEvent.id}`,
        sql`${eventsTable.detectionTime} BETWEEN ${startWindow.toISOString()} AND ${endWindow.toISOString()}`
      )
    );

  // Haversine formula
  function angularSeparation(ra1: number, dec1: number, ra2: number, dec2: number) {
    const dToR = Math.PI / 180;
    const rToD = 180 / Math.PI;
    const sinDDec = Math.sin(((dec2 - dec1) * dToR) / 2);
    const sinDRa = Math.sin(((ra2 - ra1) * dToR) / 2);
    const a =
      sinDDec * sinDDec +
      Math.cos(dec1 * dToR) * Math.cos(dec2 * dToR) * sinDRa * sinDRa;
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * rToD;
  }

  const getCompatibilityWeight = (type1: string, type2: string) => {
    const pair = [type1, type2].sort().join("-");
    switch (pair) {
      case "GRB-GW": return 1.0;
      case "EP-GW": return 0.8;
      case "GRB-NU": return 0.8;
      case "FRB-GW": return 0.5;
      case "EP-NU": return 0.8;
      default:
        // Identical types get high weight assuming we want to find duplicated events
        // across observatories.
        if (type1 === type2) return 0.9;
        return 0.3;
    }
  };

  const results = [];

  for (const candidate of candidates) {
    // Temporal Score (Gaussian)
    const deltaTSeconds = (candidate.detectionTime.getTime() - targetEvent.detectionTime.getTime()) / 1000;
    
    // Vary sigma based on pair
    const pair = [targetEvent.eventType, candidate.eventType].sort().join("-");
    let sigmaT = 86400; // 1 day default
    if (pair === "GRB-GW") sigmaT = 3600; // 1 hour
    else if (pair === "EP-GW") sigmaT = 86400; // 24 hours
    else if (pair === "GRB-NU") sigmaT = 604800; // 7 days
    else if (pair === "FRB-GW") sigmaT = 86400; // 24 hours
    
    const temporalScore = Math.exp(-(deltaTSeconds * deltaTSeconds) / (2 * sigmaT * sigmaT));

    // Spatial Score (Gaussian)
    const separationDeg = angularSeparation(
      targetEvent.ra, targetEvent.dec,
      candidate.ra, candidate.dec
    );

    // convert error radius from arcmin to degrees
    const err1 = Math.max((targetEvent.errorRadius || 0) / 60, 0.1);
    const err2 = Math.max((candidate.errorRadius || 0) / 60, 0.1);
    const sigmaS = Math.sqrt(err1 * err1 + err2 * err2);
    
    const spatialScore = Math.exp(-(separationDeg * separationDeg) / (2 * sigmaS * sigmaS));

    const wType = getCompatibilityWeight(targetEvent.eventType, candidate.eventType);

    const finalScore = Math.round(wType * ((temporalScore + spatialScore) / 2) * 100);

    if (finalScore > 1) {
      results.push({
        id: String(candidate.id),
        eventId: candidate.eventId,
        eventType: candidate.eventType,
        observatory: candidate.observatory,
        score: finalScore,
        angularSeparationDeg: separationDeg,
        deltaTSeconds,
        spatialScore,
        temporalScore
      });
    }
  }

  // Sort descending and take top 10 matches
  results.sort((a, b) => b.score - a.score);
  res.json(results.slice(0, 10));
});

export default router;
