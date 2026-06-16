import { db, schema } from "@workspace/db";
import { sql } from "drizzle-orm";

async function run() {
  const types = ["GRB", "FRB", "GW", "NU", "EP"];

  for (const t of types) {
    const stats = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(ra) as ra_count,
        COUNT(dec) as dec_count,
        COUNT(error_radius) as err_count,
        COUNT(detection_time) as time_count,
        COUNT(observatory) as obs_count,
        COUNT(snr) as snr_count,
        COUNT(far) as far_count,
        COUNT(fluence) as fluence_count,
        COUNT(dm) as dm_count,
        COUNT(classification_tier) as tier_count
      FROM core.events
      WHERE event_type = ${t}
    `);
    console.log(`Type: ${t}`);
    console.log(stats.rows[0]);
  }
  process.exit(0);
}

run().catch(console.error);
