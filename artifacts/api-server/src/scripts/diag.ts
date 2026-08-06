import { db, users as usersTable } from "@workspace/db";
import { signToken } from "../middlewares/auth.js";

async function run() {
  const [user] = await db.select().from(usersTable).limit(1);
  if (!user) {
    console.error("No users found");
    process.exit(1);
  }

  process.env.JWT_SECRET = "AstroSentinelSecret";
  console.log("Found user:", user.id);
  const token = signToken({ userId: user.id, email: user.email, role: "admin" });

  console.log("Fetching preferences...");
  const res = await fetch("http://localhost:8000/api/notifications/preferences", {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Body: ${text}`);
  process.exit(0);
}

run().catch(console.error);
