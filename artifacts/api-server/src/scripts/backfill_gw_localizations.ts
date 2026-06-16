import { db, events, eventLocalizations, labs } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";

async function verifyUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function run() {
  console.log("Starting backfill for missing GW localizations...");

  // 1. Get default lab ID
  const allLabs = await db.select().from(labs).limit(1);
  if (allLabs.length === 0) {
    console.error("No labs found. Cannot backfill.");
    process.exit(1);
  }
  const labId = allLabs[0].id;

  // 2. Fetch missing events
  const missing = await db.select({ id: events.id, eventId: events.eventId })
    .from(events)
    .leftJoin(eventLocalizations, eq(events.id, eventLocalizations.eventId))
    .where(and(eq(events.eventType, "GW"), isNull(eventLocalizations.id)));

  console.log(`Found ${missing.length} GW events without localizations.`);

  let insertedCount = 0;
  
  // 3. Process each sequentially
  for (const event of missing) {
    const bayestarUrl = `https://gracedb.ligo.org/api/superevents/${event.eventId}/files/bayestar.fits.gz`;
    const lalinferenceUrl = `https://gracedb.ligo.org/api/superevents/${event.eventId}/files/LALInference.fits.gz`;

    let finalUrl = null;
    let finalMethod = null;

    if (await verifyUrl(bayestarUrl)) {
      finalUrl = bayestarUrl;
      finalMethod = "bayestar";
    } else if (await verifyUrl(lalinferenceUrl)) {
      finalUrl = lalinferenceUrl;
      finalMethod = "lalinference";
    }

    if (finalUrl) {
      await db.insert(eventLocalizations).values({
        eventId: event.id,
        labId: labId,
        method: finalMethod as string,
        version: 1,
        fitsUrl: finalUrl,
        isLatest: true
      });
      console.log(`[Inserted] ${event.eventId} -> ${finalMethod}`);
      insertedCount++;
    } else {
      console.log(`[Skipped] ${event.eventId} -> No FITS file found.`);
    }
    
    // Add small delay to not hammer GraceDB
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`Backfill complete. Inserted ${insertedCount} localizations.`);
  process.exit(0);
}

run().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
