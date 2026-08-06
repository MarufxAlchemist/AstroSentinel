import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function run() {
  try {
    await db.execute(sql`ALTER TABLE alerts.alert_subscriptions ADD COLUMN IF NOT EXISTS priority_level text NOT NULL DEFAULT 'all';`);
    await db.execute(sql`ALTER TABLE alerts.alert_subscriptions ADD COLUMN IF NOT EXISTS behaviour jsonb NOT NULL DEFAULT '{"aiSummary":true,"correlation":true,"localization":true,"digest":false,"instant":true}'::jsonb;`);
    console.log("Columns added successfully");
  } catch (err) {
    console.error("Error:", err);
  }
  process.exit(0);
}
run();
