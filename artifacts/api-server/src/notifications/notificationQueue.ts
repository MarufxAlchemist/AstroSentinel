/**
 * notificationQueue.ts
 * --------------------
 * In-process async queue with retry logic and exponential back-off.
 *
 * Design
 * ──────
 *   • No external dependencies (Redis, BullMQ, etc.) — self-contained.
 *   • FIFO queue. Jobs are processed sequentially to avoid hammering the
 *     email provider on bursts of simultaneous Kafka events.
 *   • Each job is attempted up to MAX_ATTEMPTS times.
 *   • Back-off delay: INITIAL_DELAY_MS × 2^(attempt-1)
 *       attempt 1 → immediate (no delay before first try)
 *       attempt 2 → 2 s
 *       attempt 3 → 4 s
 *   • Permanent failures (marked isPermanent by the email provider) are
 *     dropped immediately — retrying them would be useless and abusive.
 *
 * Usage
 * ──────
 *   enqueueNotificationJob(job)   — called by notificationService
 *   _drainQueue()                 — internal, auto-triggered
 */

import crypto from "node:crypto";
import { logNotificationAttempt } from "./notificationLogger.js";
import type { EmailProvider }     from "./emailService.js";
import type { EmailContent }      from "./notificationTemplates.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS       = 3;
const INITIAL_DELAY_MS   = 2_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationJob {
  /** Unique ID for this entire notification job (shared across retries). */
  notification_id: string;
  /** GCN event_id for logging. */
  event_id: string;
  /** Recipient email address. */
  recipient: string;
  /** Pre-built email content. */
  content: EmailContent;
  /** The provider to use (injected by notificationService). */
  provider: EmailProvider;
  /** 1-based attempt counter. Managed internally. */
  attempt: number;
}

// ---------------------------------------------------------------------------
// Queue state
// ---------------------------------------------------------------------------

const _queue: NotificationJob[] = [];
let   _draining                 = false;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function _processJob(job: NotificationJob): Promise<void> {
  // Back-off delay: no delay on attempt 1, INITIAL_DELAY_MS on attempt 2, etc.
  if (job.attempt > 1) {
    const delay = INITIAL_DELAY_MS * Math.pow(2, job.attempt - 2);
    await _sleep(delay);
  }

  const result = await job.provider.send({
    to:      job.recipient,
    subject: job.content.subject,
    html:    job.content.html,
    text:    job.content.text,
  });

  if (result.success) {
    logNotificationAttempt({
      notification_id: job.notification_id,
      event_id:        job.event_id,
      recipient:       job.recipient,
      status:          "sent",
      provider:        job.provider.name,
      sent_time:       new Date().toISOString(),
      attempt:         job.attempt,
    });
    return; // done
  }

  // Failed
  logNotificationAttempt({
    notification_id: job.notification_id,
    event_id:        job.event_id,
    recipient:       job.recipient,
    status:          "failed",
    provider:        job.provider.name,
    sent_time:       new Date().toISOString(),
    attempt:         job.attempt,
    failure_reason:  result.error,
  });

  // Permanent failure — do not retry
  if (result.isPermanent) return;

  // Transient failure — re-enqueue if under the attempt limit
  if (job.attempt < MAX_ATTEMPTS) {
    _queue.push({ ...job, attempt: job.attempt + 1 });
  }
}

async function _drainQueue(): Promise<void> {
  if (_draining) return;
  _draining = true;

  while (_queue.length > 0) {
    const job = _queue.shift()!;
    await _processJob(job).catch(() => {
      // _processJob is already error-tolerant; this is a last resort catch
    });
  }

  _draining = false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a notification job for delivery.
 * Returns immediately — delivery is asynchronous.
 */
export function enqueueNotificationJob(
  event_id: string,
  recipient: string,
  content: EmailContent,
  provider: EmailProvider,
): void {
  const job: NotificationJob = {
    notification_id: crypto.randomUUID(),
    event_id,
    recipient,
    content,
    provider,
    attempt: 1,
  };

  _queue.push(job);
  void _drainQueue(); // fire-and-forget, errors are caught inside
}

/** Current queue depth (useful for health checks). */
export function getQueueDepth(): number {
  return _queue.length;
}
