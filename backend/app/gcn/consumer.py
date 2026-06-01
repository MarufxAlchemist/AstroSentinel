import os
import json
import uuid
import itertools

from datetime import datetime, timezone

from dotenv import load_dotenv
from gcn_kafka import Consumer

from app.gcn.topics import TOPICS, get_topic_meta
from app.gcn.normalizer import normalize
from app.websocket.manager import manager, alert_buffer

load_dotenv()

client_id     = os.getenv("GCN_CLIENT_ID")
client_secret = os.getenv("GCN_CLIENT_SECRET")

# ---------------------------------------------------------------------------
# Consumer group IDs — two distinct groups so live listener and history export
# never share or clobber each other's committed offsets.
#
#   gcn-live-listener-v1   — this module (live WebSocket feed, offset=latest)
#   gcn-history-export-v1  — scripts/export_gcn_history.py (offset=earliest)
#
# Using a stable named group ID (rather than a random UUID) means Kafka
# remembers the committed position across server restarts, so reconnecting
# after a crash picks up exactly where it left off instead of skipping events.
# ---------------------------------------------------------------------------
LIVE_GROUP_ID = "gcn-live-listener-v1"

consumer = Consumer(
    client_id=client_id,
    client_secret=client_secret,
    config={
        "group.id":           LIVE_GROUP_ID,
        # 'latest' — live listener only cares about new alerts, not history.
        # The history export script uses 'earliest' on its own separate group.
        "auto.offset.reset":  "latest",
        # Auto-commit is fine for the live listener; if the server crashes
        # mid-batch, at most one poll window of messages is skipped (acceptable
        # for a real-time dashboard).  The export script disables auto-commit
        # and commits manually after a full drain.
        "enable.auto.commit": True,
    },
)

consumer.subscribe(TOPICS)

SCHEMA_VERSION = "1"

# Monotonically increasing counter — resets only on server restart.
# The frontend stores the last seen sequence and sends it back in
# history_request so the server can deduplicate replayed events.
_sequence_counter = itertools.count(start=1)


# ---------------------------------------------------------------------------
# Synchronous listener (for test_consumer.py standalone use)
# ---------------------------------------------------------------------------

def listen():
    print("=" * 60)
    print("Connected to GCN Kafka")
    print("Subscribed Topics:")

    for topic in TOPICS:
        print(f"  • {topic}")

    print("\nWaiting for alerts...")
    print("=" * 60)

    while True:
        for message in consumer.consume(timeout=1):

            if message.error():
                print("Kafka Error:", message.error())
                continue

            try:
                topic = message.topic()
                value = message.value()

                if isinstance(value, bytes):
                    value = value.decode("utf-8")

                print("\n" + "=" * 60)
                print("NEW ALERT RECEIVED")
                print(f"TOPIC: {topic}")
                print("=" * 60)

                try:
                    data = json.loads(value)
                    print(json.dumps(data, indent=2, ensure_ascii=False))
                except json.JSONDecodeError:
                    print(value)

            except Exception as e:
                print("\nUnexpected Error:")
                print(str(e))


# ---------------------------------------------------------------------------
# Async processor (called by background_listener.py)
# ---------------------------------------------------------------------------

async def process_alert(message) -> None:
    """
    Parse a raw Kafka message, normalize it into an AstroEvent dict,
    and broadcast a fully typed envelope to all connected WebSocket clients.

    Envelope shape (schema_version 1):
    {
        "type":           "alert",
        "schema_version": "1",
        "sent_at":        ISO-8601,
        "event":          { ...AstroEvent camelCase fields... },
        "notification": {
            "event_id":   str,
            "event_type": str,
            "observatory": str,
            "timestamp":  ISO-8601,
            "priority":   "normal" | "high"
        }
    }
    """
    try:
        topic = message.topic()
        value = message.value()

        if isinstance(value, bytes):
            value = value.decode("utf-8")

        try:
            raw = json.loads(value)
        except json.JSONDecodeError:
            raw = {"raw_text": value}

        meta  = get_topic_meta(topic)
        event = normalize(topic, raw)

        notification = {
            "event_id":    event["eventId"],
            "event_type":  event["eventType"],
            "observatory": event["observatory"],
            "timestamp":   event["detectionTime"],
            "priority":    meta.priority,
        }

        envelope = {
            "type":           "alert",
            "schema_version": SCHEMA_VERSION,
            "sent_at":        datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "sequence":       next(_sequence_counter),
            "event":          event,
            "notification":   notification,
        }

        # Push to ring buffer BEFORE broadcast so any reconnecting client
        # that joins during broadcast already has this event available.
        alert_buffer.push(envelope)

        await manager.broadcast(envelope)

        # Let the manager track last_alert_at and last_sequence for heartbeats.
        manager.record_alert(
            sent_at=envelope["sent_at"],
            sequence=envelope["sequence"],
        )

        print(
            f"[consumer] Broadcasted alert "
            f"topic={topic} event_id={event['eventId']} "
            f"type={event['eventType']}"
        )

    except Exception as e:
        print(f"[consumer] process_alert error: {e}")