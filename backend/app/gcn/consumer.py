import os
import json
import uuid

from datetime import datetime, timezone

from dotenv import load_dotenv
from gcn_kafka import Consumer

from app.gcn.topics import TOPICS, get_topic_meta
from app.gcn.normalizer import normalize
from app.websocket.manager import manager

load_dotenv()

client_id     = os.getenv("GCN_CLIENT_ID")
client_secret = os.getenv("GCN_CLIENT_SECRET")

consumer = Consumer(
    client_id=client_id,
    client_secret=client_secret,
)

consumer.subscribe(TOPICS)

SCHEMA_VERSION = "1"


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
            "event":          event,
            "notification":   notification,
        }

        await manager.broadcast(envelope)

        print(
            f"[consumer] Broadcasted alert "
            f"topic={topic} event_id={event['eventId']} "
            f"type={event['eventType']}"
        )

    except Exception as e:
        print(f"[consumer] process_alert error: {e}")