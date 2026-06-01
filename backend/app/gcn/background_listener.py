"""
background_listener.py
-----------------------
Runs two concurrent asyncio tasks:

1. _kafka_loop   — polls the GCN Kafka consumer in a thread-pool executor
                   to avoid blocking the asyncio event loop, then calls
                   process_alert for each valid message.

2. _heartbeat_loop — sends a WebSocket heartbeat every 30 seconds so
                     clients can detect a dead listener without a TCP drop.
"""

import asyncio
from datetime import datetime, timezone

from app.gcn.consumer import consumer, process_alert
from app.websocket.manager import manager

HEARTBEAT_INTERVAL_S = 30
KAFKA_POLL_TIMEOUT_S = 1.0  # passed to consumer.consume()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


# ---------------------------------------------------------------------------
# Kafka poll — runs in thread executor so it never blocks the event loop
# ---------------------------------------------------------------------------

def _sync_consume(timeout: float) -> list:
    """
    Blocking call to consumer.consume().
    Executed via run_in_executor so the asyncio loop is never stalled.
    Returns a list of Message objects (may be empty).
    """
    try:
        return consumer.consume(timeout=timeout) or []
    except Exception as exc:
        print(f"[kafka] consume error: {exc}")
        return []


async def _kafka_loop() -> None:
    """Poll Kafka and process alerts indefinitely."""
    print("[kafka] Background listener started")
    loop = asyncio.get_event_loop()

    while True:
        # Run the blocking consume() call in a thread pool
        messages = await loop.run_in_executor(None, _sync_consume, KAFKA_POLL_TIMEOUT_S)

        for message in messages:
            if message.error():
                print(f"[kafka] Message error: {message.error()}")
                continue
            await process_alert(message)

        # Yield control to the event loop between poll cycles
        await asyncio.sleep(0)


async def _heartbeat_loop() -> None:
    """Send a heartbeat to all clients every HEARTBEAT_INTERVAL_S seconds."""
    print(f"[heartbeat] Sending every {HEARTBEAT_INTERVAL_S}s")

    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_S)
        try:
            await manager.send_heartbeat()
        except Exception as exc:
            print(f"[heartbeat] send error: {exc}")



# ---------------------------------------------------------------------------
# Entry point called from main.py lifespan
# ---------------------------------------------------------------------------

async def start_listener() -> None:
    """
    Start both the Kafka polling loop and the heartbeat loop concurrently.
    This coroutine runs forever; cancel it via the task returned by
    asyncio.create_task(start_listener()).
    """
    await asyncio.gather(
        _kafka_loop(),
        _heartbeat_loop(),
    )