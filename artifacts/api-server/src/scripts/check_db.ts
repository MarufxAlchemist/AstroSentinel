import { db, alertSubscriptions } from "@workspace/db";
async function run() {
  try {
    const subs = await db.select().from(alertSubscriptions).limit(1);
    console.log("Success:", subs);
  } catch (err) {
    console.error("Error:", err);
  }
  process.exit(0);
}
run();
