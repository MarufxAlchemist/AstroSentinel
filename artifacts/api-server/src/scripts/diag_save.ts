import { db, users } from "@workspace/db";
import { signToken } from "../middlewares/auth.js";
import { eq } from "drizzle-orm";

async function run() {
  process.env.JWT_SECRET = "AstroSentinelSecret";
  const user = await db.query.users.findFirst();
  if (!user) throw new Error("No user found");
  
  const token = signToken({ userId: user.id, email: user.email, role: "admin" });
  
  console.log("Saving preferences...");
  const res = await fetch("http://localhost:8000/api/notifications/preferences", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: "maruf@test.com",
      channels: ["email"],
      eventTypes: ["GRB","GW","FRB","Neutrinos","Einstein Probe"],
      priorityLevel: "all",
      observatories: ["Swift BAT","Fermi GBM","Einstein Probe","LIGO/Virgo/KAGRA","IceCube","CHIME"],
      behaviour: {
        aiSummary: true,
        correlation: true,
        localization: true,
        digest: false,
        instant: true
      },
      isActive: true
    })
  });
  
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text);

  console.log("Toggling subscription...");
  const res2 = await fetch("http://localhost:8000/api/notifications/preferences/toggle", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  console.log("Status:", res2.status);
  console.log("Body:", await res2.text());
  
  process.exit(0);
}
run().catch(console.error);
