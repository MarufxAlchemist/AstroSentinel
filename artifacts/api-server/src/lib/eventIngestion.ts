import { logger } from "./logger";

// =============================================================================
// SIMULATOR DISABLED — eventIngestion.ts
// =============================================================================
//
// All synthetic event generation has been disabled.
// Real astrophysical events are sourced exclusively from the GCN Kafka broker
// via kafkaConsumer.ts, which subscribes to the following topics:
//
//   • igwn.gwalert                                   (GW  — LVK superevents)
//   • gcn.notices.chime.frb                          (FRB — CHIME)
//   • gcn.notices.icecube.lvk_nu_track_search         (NU  — IceCube)
//   • gcn.notices.icecube.gold_bronze_track_alerts    (NU  — IceCube GOLD/BRONZE)
//   • gcn.notices.swift.bat.guano                     (GRB — Swift-BAT)
//   • gcn.notices.einstein_probe.wxt.alert            (GRB — Einstein Probe)
//
// startIngestion() is now a no-op.
// Do NOT re-enable the simulator interval loop below.
//
// Original simulator code is archived in the block comment at the bottom of
// this file for reference. It is never executed.
// =============================================================================

// ---------------------------------------------------------------------------
// Public API stubs
// ---------------------------------------------------------------------------

let _simulatorDisabledLogged = false;

/**
 * No-op. Real ingestion is handled by kafkaConsumer.ts → startKafkaConsumer().
 * Kept for import compatibility — index.ts still imports this symbol.
 */
export function startIngestion(): void {
  if (!_simulatorDisabledLogged) {
    _simulatorDisabledLogged = true;
    logger.warn(
      { source: "eventIngestion" },
      "[SIMULATOR DISABLED] startIngestion() called but is a no-op. " +
      "Events come from the GCN Kafka consumer (kafkaConsumer.ts)."
    );
  }
}

/** No-op. Counterpart to startIngestion(). */
export function stopIngestion(): void {
  // no-op — the simulator interval was never started
}

// =============================================================================
// ARCHIVED SIMULATOR CODE — NOT EXECUTED
// =============================================================================
// Everything below is inside a block comment. It will never run.
// =============================================================================

/*
import { db, eventsTable } from "@workspace/db";
import { broadcastEvent } from "./eventBroadcaster";
import { applyAlertFilter } from "./alertFilter";
import type { Lifecycle } from "./alertFilter";

const EVENT_TYPES = ["GRB", "GW", "FRB"] as const;
type EventType = typeof EVENT_TYPES[number];

const OBSERVATORIES: Record<EventType, string[]> = {
  GRB: ["Swift", "Fermi", "INTEGRAL"],
  GW:  ["LIGO-Hanford", "LIGO-Livingston", "Virgo", "KAGRA"],
  FRB: ["CHIME", "ASKAP", "Parkes"],
};

const TOPIC_MAP: Record<EventType, { topic: string; observatory: string }[]> = {
  GRB: [
    { topic: "gcn.notices.swift",           observatory: "Swift (BAT)" },
    { topic: "gcn.notices.fermi",           observatory: "Fermi (GBM)" },
    { topic: "gcn.notices.integral",        observatory: "INTEGRAL (SPI-ACS)" },
  ],
  GW: [
    { topic: "igwn.gwalert.LVK_ALERT",     observatory: "LIGO (H1,L1)" },
    { topic: "igwn.gwalert.LVK_ALERT",     observatory: "LIGO (H1,L1,V1)" },
    { topic: "igwn.gwalert.LVK_ALERT",     observatory: "LIGO (H1,L1,V1,K1)" },
  ],
  FRB: [
    { topic: "gcn.notices.chime",           observatory: "CHIME/FRB" },
    { topic: "gcn.notices.askap",           observatory: "ASKAP (CRAFT)" },
    { topic: "gcn.notices.icecube.cascade", observatory: "IceCube" },
  ],
};

const REJECTION_SCENARIOS = [
  { topic: "igwn.gwalert.LVK_ALERT",       payload: { alert_type: "RETRACTION", superevent_id: "S240601a", event: { significant: true } },  label: "IGWN retraction"    },
  { topic: "igwn.gwalert.LVK_ALERT",       payload: { alert_type: "PRELIMINARY", superevent_id: "MS240601a", event: { significant: true } }, label: "IGWN MDC/mock event" },
  { topic: "igwn.gwalert.LVK_ALERT",       payload: { alert_type: "PRELIMINARY", superevent_id: "S240602b", event: { significant: false } }, label: "IGWN sub-threshold"  },
  { topic: "gcn.notices.swift",             payload: { trigger_type: "TEST", instrument: "BAT" },                                            label: "Swift TEST trigger"  },
  { topic: "gcn.notices.einstein_probe",   payload: { trigger_type: "TEST", alert_type: "" },                                               label: "EP TEST"            },
  { topic: "gcn.notices.icecube.cascade",  payload: { is_retraction: true, stream: "GOLD" },                                               label: "IceCube retraction" },
];

let eventCounter = 0;
function randomBetween(min: number, max: number) { return Math.random() * (max - min) + min; }

function toMicrosecondTimestamp(): string {
  const nowNs = BigInt(Date.now()) * 1000000n;
  const microseconds = nowNs / 1000n;
  const date = new Date(Number(microseconds / 1000n));
  const us = Number(microseconds % 1000000n);
  const isoBase = date.toISOString().replace("Z", "");
  const parts = isoBase.split(".");
  return `${parts[0]}.${String(us).padStart(6, "0")}`;
}

function computeGalacticCoords(ra: number, dec: number): { galLat: number; galLon: number } {
  const raRad  = (ra  * Math.PI) / 180, decRad = (dec * Math.PI) / 180;
  const raNGP  = (192.85948 * Math.PI) / 180, decNGP = (27.12825 * Math.PI) / 180;
  const lNCP   = (122.93192 * Math.PI) / 180;
  const sinB   = Math.sin(decRad) * Math.sin(decNGP) + Math.cos(decRad) * Math.cos(decNGP) * Math.cos(raRad - raNGP);
  const galLat = (Math.asin(Math.max(-1, Math.min(1, sinB))) * 180) / Math.PI;
  const cosL   = Math.cos(decRad) * Math.sin(raRad - raNGP);
  const sinL   = Math.sin(decRad) * Math.cos(decNGP) - Math.cos(decRad) * Math.sin(decNGP) * Math.cos(raRad - raNGP);
  const galLon = (((lNCP - Math.atan2(cosL, sinL)) * 180) / Math.PI + 360) % 360;
  return { galLat: Math.round(galLat * 100) / 100, galLon: Math.round(galLon * 100) / 100 };
}

function mockSunMoonDistance(_ra: number, _dec: number) {
  return { sunDistance: Math.round(randomBetween(30, 150) * 10) / 10, moonDistance: Math.round(randomBetween(5, 120) * 10) / 10 };
}

const dailyCounters: Record<string, number> = {};
function getSuffix(n: number): string {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
function generateEventId(type: string, date: Date): string {
  const prefix = `${type}${date.getUTCFullYear().toString().slice(2)}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  if (dailyCounters[prefix] === undefined) dailyCounters[prefix] = 0;
  const count = dailyCounters[prefix]!;
  dailyCounters[prefix] = count + 1;
  return count === 0 ? prefix : `${prefix}${getSuffix(count)}`;
}

type AlertType = "PRELIMINARY" | "INITIAL" | "UPDATE" | "CONFIRMED";
const GW_ALERT_TYPES: AlertType[] = ["PRELIMINARY", "PRELIMINARY", "INITIAL", "UPDATE", "CONFIRMED"];
const SWIFT_TRIGGERS: string[] = ["ALERT", "ALERT", "INITIAL", "UPDATE", "FINAL"];
const ICECUBE_STREAMS: string[] = ["GOLD", "BRONZE", "BRONZE"];

function buildSimulatedPayload(eventType: EventType, topic: string, eventId: string): Record<string, unknown> {
  if (topic.startsWith("igwn.gwalert")) {
    const alertType = GW_ALERT_TYPES[Math.floor(Math.random() * GW_ALERT_TYPES.length)]!;
    return { alert_type: alertType, superevent_id: eventId, event: { significant: true, pipeline: "GstLAL", instruments: "H1,L1" }, preferred_event: { pipeline: "GstLAL", instruments: "H1,L1" } };
  }
  if (topic.startsWith("gcn.notices.icecube")) {
    return { is_retraction: false, stream: ICECUBE_STREAMS[Math.floor(Math.random() * ICECUBE_STREAMS.length)]!, event_name: eventId };
  }
  if (topic.startsWith("gcn.notices.einstein_probe")) {
    return { trigger_type: "ALERT", alert_type: "PRELIMINARY", event_id: eventId };
  }
  if (topic.startsWith("gcn.notices.swift")) {
    return { trigger_type: SWIFT_TRIGGERS[Math.floor(Math.random() * SWIFT_TRIGGERS.length)]!, instrument: "BAT", event_id: eventId };
  }
  return { alert_type: "PRELIMINARY", event_id: eventId, observatory: "INTEGRAL" };
}

async function generateAndStoreEvent() {
  // ... full simulator body omitted for brevity — see git history
}

let ingestionInterval: ReturnType<typeof setTimeout> | null = null;

// NOT exported — never called
function _DISABLED_startIngestion() {
  if (ingestionInterval) return;
  void generateAndStoreEvent();
  const scheduleNext = () => {
    const delay = Math.floor(randomBetween(1000, 3000));
    ingestionInterval = setTimeout(() => {
      void generateAndStoreEvent().finally(() => { ingestionInterval = null; scheduleNext(); });
    }, delay);
  };
  scheduleNext();
}
*/
