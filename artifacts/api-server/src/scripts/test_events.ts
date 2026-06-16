import { db } from "@workspace/db";
import { events, eventLocalizations } from "@workspace/db/src/schema/events";
import { eq, isNull, and } from "drizzle-orm";

async function run() {
  const missing = await db.select({ id: events.id, eventId: events.eventId })
    .from(events)
    .leftJoin(eventLocalizations, eq(events.id, eventLocalizations.eventId))
    .where(and(eq(events.eventType, "GW"), isNull(eventLocalizations.id)));
    
  console.log('Total missing localizations for GW events:', missing.length);
  process.exit(0);
}
run().catch(console.error);
