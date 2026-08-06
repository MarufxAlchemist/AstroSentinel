import { db, users as usersTable } from "@workspace/db";
import { signToken } from "../middlewares/auth.js";

async function run() {
  const [user] = await db.select().from(usersTable).limit(1);
  if (!user) {
    console.error("No users found");
    process.exit(1);
  }

  process.env.JWT_SECRET = "AstroSentinelSecret";
  const token = signToken({ userId: user.id, email: user.email, role: "admin" });

  const payload = {
    email: user.email,
    channels: ["email"],
    eventTypes: ["GRB", "GW", "FRB", "Neutrinos", "Einstein Probe"],
    priorityLevel: "all",
    observatories: ["Swift BAT", "Fermi GBM", "Einstein Probe", "LIGO/Virgo/KAGRA", "IceCube", "CHIME"],
    behaviour: {
      aiSummary: true,
      correlation: true,
      localization: true,
      digest: false,
      instant: true
    }
  };

  const res = await fetch("http://localhost:8000/api/notifications/preferences", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Body: ${text}`);
  process.exit(0);
}

run().catch(console.error);
