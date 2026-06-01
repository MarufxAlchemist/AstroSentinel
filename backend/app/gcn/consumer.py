import os
import json

from dotenv import load_dotenv
from gcn_kafka import Consumer

load_dotenv()

client_id = os.getenv("GCN_CLIENT_ID")
client_secret = os.getenv("GCN_CLIENT_SECRET")

consumer = Consumer(
    client_id=client_id,
    client_secret=client_secret
)

TOPICS = [
    "gcn.notices.chime.frb",
    "gcn.notices.einstein_probe.wxt.alert",
    "gcn.notices.icecube.lvk_nu_track_search",
    "gcn.notices.icecube.gold_bronze_track_alerts",
    "igwn.gwalert",
    "gcn.notices.swift.bat.guano"
]

consumer.subscribe(TOPICS)


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
                print(f"NEW ALERT RECEIVED")
                print(f"TOPIC: {topic}")
                print("=" * 60)

                try:
                    data = json.loads(value)

                    print(
                        json.dumps(
                            data,
                            indent=2,
                            ensure_ascii=False
                        )
                    )

                except json.JSONDecodeError:
                    print(value)

            except Exception as e:
                print("\nUnexpected Error:")
                print(str(e))