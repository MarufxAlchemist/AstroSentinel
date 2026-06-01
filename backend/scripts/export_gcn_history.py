"""
export_gcn_history.py
---------------------
One-shot script: drains all retained GCN Kafka messages from the
earliest available offset on every subscribed topic, normalises each
message through the existing normalizer.py pipeline, deduplicates by
eventId, and writes historical_events.json at the project root.

Usage (from the `backend/` directory with the venv active):

    python scripts/export_gcn_history.py

    # Optional flags:
    python scripts/export_gcn_history.py --timeout 60 --max-empty 10
    python scripts/export_gcn_history.py --out ../historical_events.json

The script NEVER modifies consumer.py or the live listener.  It
creates its own throwaway Consumer with a stable, unique group ID
(gcn-history-export-v1) and auto.offset.reset='earliest'.  Because
the group ID has never committed an offset before, Kafka will start
from the oldest retained message on every partition.

After the run is complete (all partitions report EOF), the script
commits offsets for this group so a subsequent run picks up only
NEW messages since the last export — unless --reset is passed, which
deletes the stored offsets and replays from the beginning of retention.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup — allow imports from backend/app/ without installing the package
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent   # backend/
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
from gcn_kafka import Consumer

from app.gcn.topics import TOPICS, get_topic_meta
from app.gcn.normalizer import normalize

load_dotenv(BACKEND_DIR / ".env")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Stable group ID for the historical export consumer.
# Must be different from the live listener group (which uses a random UUID).
HISTORY_GROUP_ID = "gcn-history-export-v1"

# Default path for the output file — project root, one level above backend/
DEFAULT_OUT = BACKEND_DIR.parent / "historical_events.json"

# How many seconds to wait for new messages before declaring a topic exhausted
DEFAULT_POLL_TIMEOUT_S = 5.0

# After this many consecutive empty polls across ALL topics, stop draining.
# Set high enough to survive topic partitions that are slow to rebalance.
DEFAULT_MAX_EMPTY = 6


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds") + "Z"


def _build_consumer(earliest: bool) -> Consumer:
    """
    Build a Consumer with:
      - stable group ID  → broker remembers committed offsets between runs
      - auto.offset.reset='earliest'  → start from oldest retained msg
                                        when no committed offset exists
      - enable.auto.commit=false      → we commit manually after draining
    """
    offset_policy = "earliest" if earliest else "latest"

    consumer = Consumer(
        client_id=os.getenv("GCN_CLIENT_ID"),
        client_secret=os.getenv("GCN_CLIENT_SECRET"),
        config={
            "group.id":               HISTORY_GROUP_ID,
            "auto.offset.reset":      offset_policy,
            "enable.auto.commit":     False,
            # Ensure partition EOF events are delivered so we know when
            # each partition is exhausted.
            "enable.partition.eof":   True,
        },
    )
    return consumer


def _message_to_event(message) -> dict | None:
    """
    Decode a raw Kafka message, run it through the existing normalizer,
    and return the resulting flat AstroEvent dict.

    Returns None on decode / normalizer failure (already logged).
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

        event = normalize(topic, raw)

        # Add createdAt timestamp if not present (matches existing schema)
        if "createdAt" not in event:
            event["createdAt"] = event.get("detectionTime") or _now_iso()

        return event

    except Exception as exc:
        print(f"  [warn] Failed to process message: {exc}")
        return None


# ---------------------------------------------------------------------------
# Main drain loop
# ---------------------------------------------------------------------------

def drain(
    *,
    poll_timeout: float,
    max_empty: int,
    reset_offsets: bool,
) -> list[dict]:
    """
    Drain all retained Kafka messages from earliest offset.

    Strategy
    --------
    1. Subscribe to all topics with a stable group ID and earliest reset.
    2. Poll in a tight loop.  Track per-topic EOF flags.
    3. Stop when every topic has seen a partition-EOF event AND we've had
       `max_empty` consecutive empty polls (allows late-arriving rebalances).
    4. Commit offsets so the next incremental run doesn't replay old data.
    """

    print(f"\n{'='*60}")
    print("GCN Kafka Historical Export — Phase 1")
    print(f"{'='*60}")
    print(f"Group ID      : {HISTORY_GROUP_ID}")
    print(f"Topics        : {len(TOPICS)}")
    for t in TOPICS:
        print(f"  • {t}")
    print(f"Poll timeout  : {poll_timeout}s per call")
    print(f"Max empty     : {max_empty} consecutive empty polls to stop")
    print(f"Reset offsets : {reset_offsets}")
    print(f"{'='*60}\n")

    consumer = _build_consumer(earliest=True)
    consumer.subscribe(TOPICS)

    events_by_id: dict[str, dict] = {}   # eventId → latest event dict
    eof_topics: set[str] = set()
    empty_streak = 0
    total_messages = 0
    total_errors = 0

    try:
        while True:
            messages = consumer.consume(num_messages=500, timeout=poll_timeout)

            if not messages:
                empty_streak += 1
                print(
                    f"  [poll] Empty poll #{empty_streak}/{max_empty}  "
                    f"(collected {len(events_by_id)} unique events so far)"
                )
                if empty_streak >= max_empty and eof_topics:
                    print("\n  [done] All topics exhausted (EOF + empty polls).")
                    break
                continue

            empty_streak = 0  # reset streak on any non-empty poll

            for message in messages:
                err = message.error()
                if err:
                    # confluent_kafka error code for partition EOF
                    if err.code() == -191:   # RD_KAFKA_RESP_ERR__PARTITION_EOF
                        eof_topics.add(message.topic())
                        print(
                            f"  [eof]  {message.topic()} "
                            f"partition {message.partition()} exhausted"
                        )
                    else:
                        total_errors += 1
                        print(f"  [err]  Kafka error: {err}")
                    continue

                total_messages += 1
                event = _message_to_event(message)

                if event:
                    event_id = event.get("eventId", str(uuid.uuid4()))
                    # Keep the event — last write wins for duplicate eventIds
                    # (later Kafka messages are more up-to-date updates)
                    events_by_id[event_id] = event

                if total_messages % 100 == 0:
                    print(
                        f"  [progress] {total_messages} messages → "
                        f"{len(events_by_id)} unique events"
                    )

            # Stop if all topics have reported EOF and poll is now empty
            if len(eof_topics) >= len(TOPICS) and not messages:
                print("\n  [done] All topics reached EOF.")
                break

    except KeyboardInterrupt:
        print("\n  [interrupt] Stopped by user.")
    finally:
        try:
            # Commit offsets so the next run only picks up new messages.
            # Skip commit if --reset was requested (next run replays from start).
            if not reset_offsets:
                consumer.commit(asynchronous=False)
                print("  [commit] Offsets committed for incremental future runs.")
            else:
                print("  [reset]  Offsets NOT committed — next run replays all retained data.")
        except Exception as exc:
            print(f"  [warn]  Offset commit failed: {exc}")
        finally:
            consumer.close()

    print(
        f"\n  Kafka drain complete: {total_messages} messages processed, "
        f"{total_errors} errors, {len(events_by_id)} unique events.\n"
    )

    return list(events_by_id.values())


# ---------------------------------------------------------------------------
# Output serialisation
# ---------------------------------------------------------------------------

def _sort_events(events: list[dict]) -> list[dict]:
    """Sort by detectionTime descending (newest first, matching existing JSON)."""
    def _key(e: dict) -> str:
        t = e.get("detectionTime") or e.get("createdAt") or ""
        return t

    return sorted(events, key=_key, reverse=True)


def write_output(events: list[dict], out_path: Path) -> None:
    """Serialise events to JSON and write to `out_path`."""
    sorted_events = _sort_events(events)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(sorted_events, fh, indent=2, ensure_ascii=False, default=str)

    print(f"  Written {len(sorted_events)} events → {out_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Drain GCN Kafka retained history and write historical_events.json"
        )
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_POLL_TIMEOUT_S,
        help=f"Kafka poll timeout in seconds per call (default: {DEFAULT_POLL_TIMEOUT_S})",
    )
    parser.add_argument(
        "--max-empty",
        type=int,
        default=DEFAULT_MAX_EMPTY,
        help=(
            f"Stop after this many consecutive empty polls once EOF is seen "
            f"(default: {DEFAULT_MAX_EMPTY})"
        ),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output path for historical_events.json (default: {DEFAULT_OUT})",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help=(
            "Do NOT commit offsets — next run will replay from earliest again. "
            "Useful for testing or re-importing after a schema change."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Drain Kafka and print a summary but do NOT write the output file.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    events = drain(
        poll_timeout=args.timeout,
        max_empty=args.max_empty,
        reset_offsets=args.reset,
    )

    if not events:
        print("  [warn] No events collected.  historical_events.json NOT updated.")
        sys.exit(0)

    if args.dry_run:
        print(f"  [dry-run] Would have written {len(events)} events to {args.out}")
        print("  [dry-run] Sample (first event):")
        print(json.dumps(events[0], indent=2, default=str))
        sys.exit(0)

    write_output(events, args.out)

    print("\nDone.  Restart the FastAPI server to serve the updated events.")


if __name__ == "__main__":
    main()
