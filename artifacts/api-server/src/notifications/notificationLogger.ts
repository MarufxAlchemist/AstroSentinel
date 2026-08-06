/**
 * notificationLogger.ts
 * ----------------------
 * Structured per-notification logger. Writes JSON-lines to
 * logs/notifications.jsonl in the process working directory.
 *
 * Every send attempt (success or failure, every retry) gets one entry so the
 * file is a complete audit trail that can be ingested by any log aggregator.
 *
 * Fields per entry
 * ─────────────────
 *   notification_id  – UUID v4 unique to this notification job
 *   event_id         – GCN event identifier (e.g. "GRB20260806T123456Z")
 *   recipient        – target email address
 *   status           – "sent" | "failed" | "skipped"
 *   provider         – "smtp" | "resend" | "sendgrid" | "none"
 *   sent_time        – ISO-8601 timestamp
 *   attempt          – 1-based retry counter (1 = first try)
 *   failure_reason   – populated only on status="failed"
 */

import fs   from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationStatus = "sent" | "failed" | "skipped";

export interface NotificationLogEntry {
  /** UUID for this notification job. */
  notification_id: string;
  /** GCN event_id field from core.events. */
  event_id: string;
  /** Target email address. */
  recipient: string;
  /** Outcome of this attempt. */
  status: NotificationStatus;
  /** Which email provider handled (or skipped) this send. */
  provider: string;
  /** ISO-8601 timestamp of the attempt. */
  sent_time: string;
  /** 1-based attempt counter (1 = first try, 2 = first retry, …). */
  attempt: number;
  /** Human-readable reason for failure. Omit on success. */
  failure_reason?: string;
}

// ---------------------------------------------------------------------------
// Internal setup
// ---------------------------------------------------------------------------

const LOG_DIR  = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "notifications.jsonl");

let _logDirReady = false;

function _ensureLogDir(): void {
  if (_logDirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    _logDirReady = true;
  } catch (err) {
    logger.error({ err, dir: LOG_DIR }, "[notifications] Failed to create log directory");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a single structured entry to logs/notifications.jsonl.
 * Fire-and-forget — errors are logged to pino but never thrown.
 */
export function logNotificationAttempt(entry: NotificationLogEntry): void {
  _ensureLogDir();

  const line = JSON.stringify(entry) + "\n";

  try {
    fs.appendFileSync(LOG_FILE, line, "utf-8");
  } catch (err) {
    logger.error(
      { err, entry },
      "[notifications] Failed to write notification log entry",
    );
  }

  // Mirror to the existing pino structured log at the appropriate level
  if (entry.status === "sent") {
    logger.info(
      {
        notification_id: entry.notification_id,
        event_id:        entry.event_id,
        recipient:       entry.recipient,
        provider:        entry.provider,
        attempt:         entry.attempt,
      },
      "[notifications] Email sent successfully",
    );
  } else if (entry.status === "failed") {
    logger.warn(
      {
        notification_id: entry.notification_id,
        event_id:        entry.event_id,
        recipient:       entry.recipient,
        provider:        entry.provider,
        attempt:         entry.attempt,
        failure_reason:  entry.failure_reason,
      },
      "[notifications] Email send failed",
    );
  } else {
    logger.debug(
      {
        notification_id: entry.notification_id,
        event_id:        entry.event_id,
        provider:        entry.provider,
      },
      "[notifications] Notification skipped",
    );
  }
}
