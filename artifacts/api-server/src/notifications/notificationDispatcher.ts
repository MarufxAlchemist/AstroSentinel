/**
 * notificationDispatcher.ts
 * -------------------------
 * Durable delivery for provider-backed channels (WeChat today; QQ and generic
 * webhook use the same path once their providers exist).
 *
 * WHERE THIS SITS
 * ───────────────
 *   Kafka → normalize → scientific filter → DATABASE → event accepted
 *        → notificationService (priority, correlation, dedup)
 *        → THIS (subscription matching, delivery rows, send, retry)
 *        → provider → WeCom
 *
 * Two properties this file must never lose:
 *
 * 1. IT CANNOT BLOCK OR BREAK INGESTION. Every entry point is non-throwing and
 *    is invoked fire-and-forget. A provider outage, a revoked webhook, or a
 *    database hiccup here must leave GCN consumption, persistence and the
 *    WebSocket dashboard completely unaffected.
 *
 * 2. IT DOES NOT RE-DECIDE THE SCIENCE. Priority, correlation and revision
 *    significance are already settled upstream by the Phase 5.2/5.4/5.5
 *    engines. This layer answers only "who subscribed to this, and did the
 *    message get there?".
 *
 * WHY DELIVERIES ARE ROWS AND NOT AN IN-MEMORY QUEUE
 * The existing notificationQueue.ts holds email jobs in process memory, so a
 * restart mid-backoff loses them silently. A GRB alert that vanishes because a
 * container was redeployed is exactly the alert someone needed. Deliveries
 * here are rows in alerts.alerts with next_retry_at, so a restart resumes them.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, alerts, alertSubscriptions, eventsTable } from "@workspace/db";

import { logger } from "../lib/logger.js";
import { wecomProvider } from "./providers/wechat/wecomWebhook.js";
import { tryConsume } from "./providers/rateLimiter.js";
import { decideRetry, idempotencyKey } from "./retryPolicy.js";
import { redactSecrets } from "./providers/secrets.js";
import type {
  NotificationChannel,
  NotificationPayload,
  NotificationProvider,
} from "./providers/types.js";

/** Channels with a working transport. A channel appears here only when it can deliver. */
const PROVIDERS: Partial<Record<NotificationChannel, NotificationProvider>> = {
  wechat: wecomProvider,
};

type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 3, HIGH: 2, NORMAL: 1, LOW: 0,
};

/** Maps the P0–P3 vocabulary of the priority engine onto provider priorities. */
export function toPriority(level: string): Priority {
  switch (level.toUpperCase()) {
    case "P0": return "CRITICAL";
    case "P1": return "HIGH";
    case "P2": return "NORMAL";
    default:   return "LOW";
  }
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Does this subscription want this event?
 *
 * Deliberately explicit rather than clever: each rule is one readable
 * condition, because a filtering bug here is silent — the user simply never
 * hears about a burst and has no way to tell that from "no burst happened".
 */
export function subscriptionWants(
  sub: {
    eventTypes: string[];
    observatories: string[];
    priorityLevel: string;
    lifecyclePolicy: Record<string, boolean | "significant_only"> | null;
    isActive: boolean;
  },
  ev: { eventType: string; observatory: string; lifecycle: string; isRetraction: boolean },
  priority: Priority,
): { wanted: boolean; reason?: string } {
  if (!sub.isActive) return { wanted: false, reason: "subscription inactive" };

  // A retraction always goes through. Someone acting on the original alert —
  // pointing a telescope, filing a circular — must be told it was withdrawn,
  // regardless of every other filter.
  if (ev.isRetraction) return { wanted: true };

  if (sub.eventTypes.length && !sub.eventTypes.includes(ev.eventType)) {
    return { wanted: false, reason: `event type ${ev.eventType} not subscribed` };
  }
  if (sub.observatories.length && !sub.observatories.includes(ev.observatory)) {
    return { wanted: false, reason: `observatory ${ev.observatory} not subscribed` };
  }

  const threshold = sub.priorityLevel === "critical_only" ? PRIORITY_RANK.CRITICAL
                  : sub.priorityLevel === "critical_and_high" ? PRIORITY_RANK.HIGH
                  : PRIORITY_RANK.LOW;
  if (PRIORITY_RANK[priority] < threshold) {
    return { wanted: false, reason: `priority ${priority} below ${sub.priorityLevel}` };
  }

  const policy = sub.lifecyclePolicy ?? {};
  const rule = policy[ev.lifecycle.toLowerCase()];
  if (rule === false) return { wanted: false, reason: `lifecycle ${ev.lifecycle} disabled` };
  // "significant_only" is already satisfied: the deduplication engine gates
  // this call and only forwards revisions it judged meaningful. Re-deciding it
  // here would be a second implementation of that rule, free to disagree.
  return { wanted: true };
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface AcceptedEvent {
  eventId: string;
  eventType: string;
  observatory: string;
  lifecycle: string;
  revisionCount: number;
  isRetraction: boolean;
  /** The validated event, exactly as the pipeline produced it. */
  raw: Record<string, unknown>;
}

/**
 * Create delivery rows for every matching subscription.
 *
 * Never throws. Returns how many rows were created, for logging only.
 */
export async function enqueueDeliveries(
  ev: AcceptedEvent,
  priority: Priority,
): Promise<number> {
  try {
    const channels = Object.keys(PROVIDERS) as NotificationChannel[];
    if (!channels.length) return 0;

    const subs = await db
      .select()
      .from(alertSubscriptions)
      .where(and(
        inArray(alertSubscriptions.channel, channels),
        eq(alertSubscriptions.isActive, true),
      ));
    if (!subs.length) return 0;

    // Resolve the internal PK for the FK. Looked up rather than taken from the
    // payload so this does not depend on the broadcast shape — and event_id
    // must be supplied explicitly since migration 0018 removed its default.
    const [row] = await db
      .select({ id: eventsTable.id, labId: eventsTable.labId })
      .from(eventsTable)
      .where(eq(eventsTable.eventId, ev.eventId))
      .limit(1);
    if (!row) {
      logger.warn({ eventId: ev.eventId }, "[dispatcher] event not persisted yet; skipping");
      return 0;
    }

    let created = 0;
    for (const sub of subs) {
      const verdict = subscriptionWants(
        {
          eventTypes: sub.eventTypes,
          observatories: sub.observatories,
          priorityLevel: sub.priorityLevel,
          lifecyclePolicy: sub.lifecyclePolicy as any,
          isActive: sub.isActive,
        },
        ev,
        priority,
      );
      if (!verdict.wanted) {
        logger.debug(
          { eventId: ev.eventId, subscriptionId: String(sub.id), reason: verdict.reason,
            event: "notification.filtered" },
          "[dispatcher] subscription does not want this event",
        );
        continue;
      }

      const key = idempotencyKey({
        eventId: ev.eventId,
        revisionCount: ev.revisionCount,
        subscriptionId: sub.id,
        channel: sub.channel,
      });

      // ON CONFLICT DO NOTHING against the UNIQUE index is the duplicate
      // guarantee. A redelivered Kafka message, or two dispatcher ticks
      // racing, resolves here rather than in application logic that cannot
      // see the other transaction.
      const inserted = await db
        .insert(alerts)
        .values({
          labId: sub.labId,
          eventId: row.id,
          subscriptionId: sub.id,
          channel: sub.channel,
          provider: PROVIDERS[sub.channel as NotificationChannel]?.transport ?? null,
          status: "pending",
          payload: {
            eventId: ev.eventId,
            priority,
            revisionCount: ev.revisionCount,
            event: ev.raw,
          },
          idempotencyKey: key,
        })
        .onConflictDoNothing()
        .returning({ id: alerts.id });

      if (inserted.length) {
        created++;
        logger.info(
          { eventId: ev.eventId, subscriptionId: String(sub.id), channel: sub.channel,
            deliveryId: String(inserted[0]!.id), event: "notification.created" },
          "[dispatcher] delivery queued",
        );
      } else {
        logger.debug(
          { eventId: ev.eventId, idempotencyKey: key, event: "notification.duplicate" },
          "[dispatcher] duplicate suppressed by idempotency key",
        );
      }
    }
    return created;
  } catch (err) {
    // Non-throwing by contract: ingestion must not be affected.
    logger.error({ err: redactSecrets(String(err)), eventId: ev.eventId },
      "[dispatcher] enqueue failed");
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

const DEFAULT_CLAIM_BATCH = 20;

/**
 * Send everything that is due, up to `batch` rows.
 *
 * THE LIMIT MUST BE INSIDE THE CLAIM, NOT AROUND THE LOOP.
 *
 * An earlier version flipped EVERY due row to 'processing' and then iterated
 * only the first N. The remainder were stranded: 'processing' is not a state
 * the claim query looks for, so nothing ever picked them up again. Twenty-five
 * due deliveries produced twenty sends and five permanently invisible rows —
 * a silently lost alert, which is the worst failure this system can have.
 *
 * FOR UPDATE SKIP LOCKED is the standard queue-claim: rows already locked by a
 * concurrent worker are stepped over instead of blocking, so two dispatcher
 * ticks — or two api-server containers — never take the same delivery and
 * never serialise behind each other.
 */
export async function processDueDeliveries(
  batch = DEFAULT_CLAIM_BATCH,
  now = new Date(),
): Promise<number> {
  let handled = 0;
  try {
    const claimed = await db.execute(sql`
      UPDATE alerts.alerts SET status = 'processing', last_attempt_at = ${now}
      WHERE id IN (
        SELECT id FROM alerts.alerts
        WHERE status IN ('pending', 'retrying')
          AND (next_retry_at IS NULL OR next_retry_at <= ${now})
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${batch}
      )
      RETURNING *
    `);

    const rows = (claimed as unknown as { rows?: unknown[] }).rows ?? (claimed as unknown as unknown[]);
    for (const raw of rows as Record<string, unknown>[]) {
      handled++;
      // db.execute returns snake_case columns; map to the shape deliverOne uses.
      await deliverOne({
        id: raw["id"] as bigint,
        channel: raw["channel"] as string,
        subscriptionId: raw["subscription_id"] as bigint,
        payload: raw["payload"] as Record<string, unknown>,
        retryCount: Number(raw["retry_count"] ?? 0),
        idempotencyKey: (raw["idempotency_key"] as string | null) ?? null,
      });
    }
  } catch (err) {
    logger.error({ err: redactSecrets(String(err)) }, "[dispatcher] processDue failed");
  }
  return handled;
}

/** The subset of a delivery row this function needs. */
interface ClaimedDelivery {
  id: bigint;
  channel: string;
  subscriptionId: bigint;
  payload: Record<string, unknown> | null;
  retryCount: number;
  idempotencyKey: string | null;
}

async function deliverOne(d: ClaimedDelivery): Promise<void> {
  const provider = PROVIDERS[d.channel as NotificationChannel];
  if (!provider) {
    await db.update(alerts).set({
      status: "failed",
      failureKind: "configuration",
      errorMessage: `No provider is registered for channel "${d.channel}".`,
    }).where(eq(alerts.id, d.id));
    return;
  }

  // Subscription may have been deleted between queueing and sending.
  const [sub] = await db.select().from(alertSubscriptions)
    .where(eq(alertSubscriptions.id, d.subscriptionId)).limit(1);
  if (!sub) {
    await db.update(alerts).set({
      status: "cancelled",
      errorMessage: "Subscription was removed before delivery.",
    }).where(eq(alerts.id, d.id));
    return;
  }

  // Rate limit per credential, not per channel: one lab's burst must not
  // consume another lab's allowance.
  const gate = tryConsume(`${d.channel}:${sub.id}`, provider.limits.maxMessagesPerMinute);
  if (!gate.allowed) {
    const next = new Date(Date.now() + gate.retryAfterMs);
    await db.update(alerts).set({ status: "retrying", nextRetryAt: next })
      .where(eq(alerts.id, d.id));
    logger.info(
      { deliveryId: String(d.id), channel: d.channel, retryAfterMs: gate.retryAfterMs,
        event: "notification.rate_limited" },
      "[dispatcher] deferred by local rate limiter",
    );
    return;
  }

  const p = (d.payload ?? {}) as Record<string, unknown>;
  const payload: NotificationPayload = {
    idempotencyKey: d.idempotencyKey ?? String(d.id),
    eventId: String(p["eventId"] ?? ""),
    revisionCount: Number(p["revisionCount"] ?? 0),
    priority: (p["priority"] as Priority) ?? "NORMAL",
    event: (p["event"] as Record<string, unknown>) ?? {},
    eventUrl: eventUrlFor(String(p["eventId"] ?? "")),
  };

  const result = await provider.send(sub.channelConfig as Record<string, unknown>, payload);
  const attempts = (d.retryCount ?? 0) + 1;

  if (result.ok) {
    await db.update(alerts).set({
      status: "sent",
      sentAt: new Date(),
      deliveredAt: new Date(),
      retryCount: attempts,
      providerMessageId: result.providerMessageId ?? null,
      errorMessage: null,
      errorCode: null,
      failureKind: null,
      nextRetryAt: null,
    }).where(eq(alerts.id, d.id));
    logger.info(
      { deliveryId: String(d.id), eventId: payload.eventId, channel: d.channel,
        attempt: attempts, durationMs: result.durationMs, event: "notification.sent" },
      "[dispatcher] delivered",
    );
    return;
  }

  const decision = decideRetry(result.kind, d.retryCount ?? 0, result.retryAfterMs);
  const message = redactSecrets(result.message);

  if (decision.action === "fail") {
    await db.update(alerts).set({
      status: "failed",
      retryCount: attempts,
      failureKind: result.kind,
      errorCode: result.code != null ? String(result.code) : null,
      errorMessage: `${message} ${decision.reason}`.trim(),
      nextRetryAt: null,
    }).where(eq(alerts.id, d.id));
    logger.warn(
      { deliveryId: String(d.id), eventId: payload.eventId, channel: d.channel,
        attempt: attempts, kind: result.kind, code: result.code,
        event: "notification.failed" },
      "[dispatcher] delivery failed permanently",
    );
    return;
  }

  await db.update(alerts).set({
    status: "retrying",
    // A rate-limited attempt does not spend the budget (see retryPolicy).
    retryCount: decision.countsAsAttempt ? attempts : (d.retryCount ?? 0),
    failureKind: result.kind,
    errorCode: result.code != null ? String(result.code) : null,
    errorMessage: message,
    nextRetryAt: new Date(Date.now() + decision.delayMs),
  }).where(eq(alerts.id, d.id));

  logger.info(
    { deliveryId: String(d.id), eventId: payload.eventId, channel: d.channel,
      attempt: attempts, kind: result.kind, delayMs: decision.delayMs,
      event: "notification.retry" },
    "[dispatcher] delivery scheduled for retry",
  );
}

function eventUrlFor(eventId: string): string | null {
  const base = process.env["PUBLIC_APP_URL"];
  if (!base || !eventId) return null;
  return `${base.replace(/\/+$/, "")}/events/${encodeURIComponent(eventId)}`;
}

// ---------------------------------------------------------------------------
// Background loop
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Poll for due deliveries.
 *
 * A poll loop rather than LISTEN/NOTIFY because retries are time-based: a row
 * scheduled ten minutes out needs someone to look at the clock, and a
 * notification would not fire for it.
 */
export function startDispatcher(intervalMs = 5_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void processDueDeliveries().catch((err) =>
      logger.error({ err: redactSecrets(String(err)) }, "[dispatcher] tick threw"));
  }, intervalMs);
  // Do not hold the process open on shutdown.
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs }, "[dispatcher] delivery loop started");
}

export function stopDispatcher(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
