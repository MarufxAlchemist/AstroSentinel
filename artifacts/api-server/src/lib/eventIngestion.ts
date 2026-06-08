import { db, eventsTable } from "@workspace/db";
import { broadcastEvent } from "./eventBroadcaster";
import { logger } from "./logger";

const EVENT_TYPES = ["GRB", "GW", "FRB"] as const;
const OBSERVATORIES: Record<string, string[]> = {
  GRB: ["Swift", "Fermi", "INTEGRAL"],
  GW: ["LIGO", "Virgo", "KAGRA"],
  FRB: ["CHIME", "ASKAP", "Parkes"],
};

let eventCounter = 0;

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function toMicrosecondTimestamp(): string {
  const nowNs = BigInt(Date.now()) * 1000000n;
  const microseconds = nowNs / 1000n;
  const date = new Date(Number(microseconds / 1000n));
  const us = Number(microseconds % 1000000n);
  const isoBase = date.toISOString().replace("Z", "");
  const parts = isoBase.split(".");
  const usStr = String(us).padStart(6, "0");
  return `${parts[0]}.${usStr}`;
}

function computeGalacticCoords(ra: number, dec: number): { galLat: number; galLon: number } {
  // Approximate Galactic coordinate conversion
  const raRad = (ra * Math.PI) / 180;
  const decRad = (dec * Math.PI) / 180;
  const raNGP = (192.85948 * Math.PI) / 180;
  const decNGP = (27.12825 * Math.PI) / 180;
  const lNCP = (122.93192 * Math.PI) / 180;

  const sinB = Math.sin(decRad) * Math.sin(decNGP) +
    Math.cos(decRad) * Math.cos(decNGP) * Math.cos(raRad - raNGP);
  const galLat = (Math.asin(Math.max(-1, Math.min(1, sinB))) * 180) / Math.PI;

  const cosL = Math.cos(decRad) * Math.sin(raRad - raNGP);
  const sinL = Math.sin(decRad) * Math.cos(decNGP) -
    Math.cos(decRad) * Math.sin(decNGP) * Math.cos(raRad - raNGP);
  const galLon = (((lNCP - Math.atan2(cosL, sinL)) * 180) / Math.PI + 360) % 360;

  return { galLat: Math.round(galLat * 100) / 100, galLon: Math.round(galLon * 100) / 100 };
}

function mockSunMoonDistance(ra: number, dec: number) {
  // Mock angular distances with realistic ranges
  const sunDistance = randomBetween(30, 150);
  const moonDistance = randomBetween(5, 120);
  return { sunDistance: Math.round(sunDistance * 10) / 10, moonDistance: Math.round(moonDistance * 10) / 10 };
}

const dailyCounters: Record<string, number> = {};

function getSuffix(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function generateEventId(type: string, date: Date): string {
  const year = date.getUTCFullYear().toString().slice(2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  
  const prefix = `${type}${year}${month}${day}`;
  
  if (dailyCounters[prefix] === undefined) {
    dailyCounters[prefix] = 0;
  }
  
  const count = dailyCounters[prefix]!;
  dailyCounters[prefix] = count + 1;
  
  if (count === 0) {
    return prefix;
  }
  return `${prefix}${getSuffix(count)}`;
}

async function generateAndStoreEvent() {
  const eventType = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
  const observatories = OBSERVATORIES[eventType];
  const observatory = observatories[Math.floor(Math.random() * observatories.length)];

  const now = new Date();
  const detectionTime = toMicrosecondTimestamp();
  const eventId = generateEventId(eventType, now);
  eventCounter++;

  const ra = Math.round(randomBetween(0, 360) * 100) / 100;
  const dec = Math.round(randomBetween(-90, 90) * 100) / 100;
  const errorRadius = Math.round(randomBetween(0.1, 30) * 100) / 100;
  const snr = Math.round(randomBetween(5, 50) * 10) / 10;
  const far = parseFloat(randomBetween(1e-10, 1e-5).toExponential(4));
  const fluence = eventType === "GRB" ? parseFloat(randomBetween(1e-8, 1e-5).toExponential(4)) : null;
  const dm = eventType === "FRB" ? Math.round(randomBetween(100, 2000) * 10) / 10 : null;
  const t90 = eventType === "GRB" ? Math.round(randomBetween(0.5, 60) * 10) / 10 : null;
  const peakFlux = eventType === "GW" ? null : parseFloat(randomBetween(1e-8, 1e-3).toExponential(4));
  const chirpMass = eventType === "GW" ? Math.round(randomBetween(1.2, 50) * 100) / 100 : null;
  const luminosityDistance = eventType === "GW" ? Math.round(randomBetween(10, 5000)) : null;

  const { galLat, galLon } = computeGalacticCoords(ra, dec);
  const { sunDistance, moonDistance } = mockSunMoonDistance(ra, dec);

  const eventStartNs = Date.now() * 1000;
  const latencyUs = BigInt(Math.floor(randomBetween(100, 9500)));

  try {
    const { labs } = await import("@workspace/db");
    let [defaultLab] = await db.select().from(labs).limit(1);
    if (!defaultLab) {
      [defaultLab] = await db.insert(labs).values({
        slug: "default",
        name: "Default Lab",
      }).returning();
    }

    const record = {
      labId: defaultLab.id,
      eventId,
      eventType,
      detectionTime: new Date(Date.now()),
      ra,
      dec,
      errorRadius,
      snr,
      far,
      fluence,
      dm,
      t90,
      peakFlux,
      chirpMass,
      luminosityDistance,
      galLat,
      galLon,
      sunDistance,
      moonDistance,
      latencyUs,
    };

    const [inserted] = await db.insert(eventsTable).values(record).returning();
    logger.info({ eventId, eventType, observatory }, "Event ingested");

    const broadcastPayload = {
      id: String(inserted.id),
      eventId: inserted.eventId,
      eventType: inserted.eventType,
      observatory: observatory,
      detectionTime: inserted.detectionTime.toISOString(),
      ra: inserted.ra,
      dec: inserted.dec,
      errorRadius: inserted.errorRadius,
      snr: inserted.snr,
      far: inserted.far,
      fluence: inserted.fluence ?? undefined,
      dm: inserted.dm ?? undefined,
      t90: inserted.t90 ?? undefined,
      peakFlux: inserted.peakFlux ?? undefined,
      chirpMass: inserted.chirpMass ?? undefined,
      luminosityDistance: inserted.luminosityDistance ?? undefined,
      galLat: inserted.galLat,
      galLon: inserted.galLon,
      sunDistance: inserted.sunDistance,
      moonDistance: inserted.moonDistance,
      latencyUs: Number(inserted.latencyUs),
      createdAt: inserted.createdAt.toISOString(),
    };

    broadcastEvent(broadcastPayload);

    // Simulate email alert (print GCN-style notice)
    printEmailAlert({ ...broadcastPayload, detectionTime });
  } catch (err) {
    logger.error({ err, eventId }, "Failed to ingest event");
  }
}

function printEmailAlert(event: Record<string, unknown>) {
  const subject = `[ASTROSENTINEL] ${event["eventId"]} — ${event["observatory"]} Detection`;
  const body = `
==============================================
ASTROSENTINEL ALERT — GCN NOTICE
==============================================
Subject: ${subject}

DETECTION TIME:  ${event["detectionTime"]} UTC
EVENT TYPE:      ${event["eventType"]}
OBSERVATORY:     ${event["observatory"]}

COORDINATES (J2000):
  RA:            ${event["ra"]}°
  DEC:           ${event["dec"]}°
  ERROR RADIUS:  ${event["errorRadius"]} arcmin

GALACTIC COORDINATES:
  L:             ${event["galLon"]}°
  B:             ${event["galLat"]}°

SOLAR/LUNAR GEOMETRY:
  SUN DISTANCE:  ${event["sunDistance"]}°
  MOON DISTANCE: ${event["moonDistance"]}°

SIGNIFICANCE METRICS:
  SNR:           ${event["snr"]}
  FAR:           ${event["far"]} Hz
${event["fluence"] ? `  FLUENCE:       ${event["fluence"]} erg/cm²\n` : ""}${event["dm"] ? `  DM:            ${event["dm"]} pc/cm³\n` : ""}
SYSTEM LATENCY: ${event["latencyUs"]} μs

This notice is automatically generated by AstroSentinel.
==============================================
`;
  logger.info({ emailAlert: true, eventId: event["eventId"] }, subject);
  console.log(body);
}

let ingestionInterval: ReturnType<typeof setInterval> | null = null;

export function startIngestion() {
  if (ingestionInterval) return;
  logger.info("Starting continuous event ingestion");
  // Generate first event immediately
  void generateAndStoreEvent();
  // Then every 1-3 seconds
  const scheduleNext = () => {
    const delay = Math.floor(randomBetween(1000, 3000));
    ingestionInterval = setTimeout(() => {
      void generateAndStoreEvent().finally(() => {
        ingestionInterval = null;
        scheduleNext();
      });
    }, delay);
  };
  scheduleNext();
}

export function stopIngestion() {
  if (ingestionInterval) {
    clearTimeout(ingestionInterval);
    ingestionInterval = null;
  }
}
