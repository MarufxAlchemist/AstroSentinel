import { dispatchForEvent } from "../notifications/notificationService.js";

async function run() {
  
  const mockEvent = {
    eventId: "TEST-GRB-123",
    eventType: "GRB",
    observatory: "Swift BAT",
    detectionTime: new Date().toISOString(),
    lifecycle: "preliminary",
    alertType: "INITIAL",
    classificationTier: "significant",
    snr: 12.5,
    far: 0.00001,
    errorRadius: 0.5,
    isRetraction: false,
    isHistorical: false,
    revisionCount: 0,
    ra: 100.5,
    dec: 50.2,
  };

  console.log("Dispatching test event...");
  await dispatchForEvent(mockEvent, false);
  console.log("Waiting for background email queue to drain...");
  await new Promise(r => setTimeout(r, 15000));
  console.log("Done.");
  process.exit(0);
}

run().catch(console.error);
