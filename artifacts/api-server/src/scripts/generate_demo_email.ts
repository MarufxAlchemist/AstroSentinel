import fs from "fs";
import { buildEmailContent } from "../notifications/notificationTemplates.js";

async function run() {
  const content = buildEmailContent(
    {
      eventId: "TEST-GRB-123",
      eventType: "GRB",
      observatory: "Swift BAT",
      detectionTime: new Date().toISOString(),
      lifecycle: "preliminary",
      alertType: "INITIAL",
      classificationTier: "significant",
      revisionCount: 0,
      priorityLevel: "P1",
      priorityScore: 85,
      priorityReasons: [
        "High confidence GRB",
        "Excellent localization",
        "Swift BAT detection"
      ],
      recommendation: "Follow up immediately within 1 hour.",
      correlationResult: { confidence: "NONE", bestMatch: null } as any,
      aiSummary: {
        event_id: "TEST-GRB-123",
        event_type: "GRB",
        observatory: "Swift BAT",
        phenomenology: "A highly significant long GRB with rapid onset.",
        astrophysical_context: "Likely collapsar origin given duration and spectrum.",
        observational_opportunities: "Optical afterglow follow-up strongly encouraged.",
        priority_justification: "Very bright and well-localized."
      },
      ra: 100.5,
      dec: 50.2,
      errorRadius: 0.5,
      snr: 12.5,
      far: 0.00001,
      fluence: 0.001,
      dm: null,
      t90: 25.5,
      chirpMass: null,
      luminosityDistance: null,
      latencyUs: 4500
    },
    "HIGH"
  );

  fs.writeFileSync("E:\\Maruf data\\Antigravity\\Cosmic-Alert-System\\demo_email.html", content.html);
  console.log("Demo email HTML written to root directory: demo_email.html");
  process.exit(0);
}

run().catch(console.error);
