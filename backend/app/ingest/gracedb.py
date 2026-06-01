import json
import uuid
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Setup Paths
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
HISTORY_JSON = BACKEND_DIR.parent / "historical_events.json"

# GraceDB API Endpoint for Superevents (standard for LVK O3/O4)
GRACEDB_API_URL = "https://gracedb.ligo.org/api/superevents/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds") + "Z"


def _parse_gracedb_time(t_str: str) -> datetime:
    """Parse GraceDB 'created' string to timezone-aware datetime."""
    t_str = t_str.replace(" UTC", "").strip()
    try:
        return datetime.strptime(t_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        try:
            return datetime.strptime(t_str, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=timezone.utc)
        except ValueError:
            return datetime.now(timezone.utc)


def _make_astro_event(se: dict) -> dict:
    """Map a raw GraceDB event payload to the normalized AstroEvent schema."""
    # Handle both superevents API and regular events API
    event_id = se.get("superevent_id", se.get("graceid", str(uuid.uuid4())))
    created_str = se.get("created", "")
    
    dt = _parse_gracedb_time(created_str) if created_str else datetime.now(timezone.utc)
    detection_time = dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    
    # Attempt to extract some sensible values (GraceDB list APIs are limited,
    # full details normally require downloading and parsing FITS skymaps)
    far = float(se.get("far", 0.0)) if se.get("far") else 0.0
    
    return {
        "id": str(uuid.uuid4()),
        "eventId": event_id,
        "eventType": "GW",
        "observatory": "LIGO-Virgo-KAGRA",
        "topic": "gracedb.api",  # Mark origin
        "detectionTime": detection_time,
        "ra": 0.0,
        "dec": 0.0,
        "errorRadius": 0.0,
        "snr": 0.0,
        "far": far,
        "latencyUs": 0,
        "galLon": 0.0,
        "galLat": 0.0,
        "sunDistance": 90.0,
        "moonDistance": 90.0,
        "fluence": None,
        "dm": None,
        "raw": se,
        "createdAt": _now_iso()
    }


def ingest_gracedb_events(days: int = 120):
    """
    Fetch events from GraceDB API over the last `days` days.
    Deduplicates against the existing historical_events.json via eventId.
    """
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # 1. Load existing historical events
    events_by_id = {}
    if HISTORY_JSON.exists():
        try:
            with open(HISTORY_JSON, "r", encoding="utf-8") as f:
                events = json.load(f)
                for e in events:
                    if "eventId" in e:
                        events_by_id[e["eventId"]] = e
            print(f"Loaded {len(events_by_id)} existing events from {HISTORY_JSON.name}")
        except Exception as e:
            print(f"Error loading {HISTORY_JSON.name}: {e}")

    # 2. Fetch from GraceDB with pagination
    url = GRACEDB_API_URL
    new_events_count = 0
    keep_fetching = True
    
    print(f"Fetching GraceDB events since {cutoff_date.isoformat()} ...")
    headers = {"Accept": "application/json"}
    
    while url and keep_fetching:
        try:
            print(f"  Requesting {url}")
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode('utf-8'))
                
            # GraceDB returns lists in either "superevents" or "events"
            items = data.get("superevents", data.get("events", []))
            
            if not items:
                break
                
            for se in items:
                created_str = se.get("created", "")
                if created_str:
                    dt = _parse_gracedb_time(created_str)
                    if dt < cutoff_date:
                        # We hit the 120 days limit; stop paginating
                        keep_fetching = False
                        break
                
                astro_event = _make_astro_event(se)
                event_id = astro_event["eventId"]
                
                # 3. Deduplicate
                if event_id not in events_by_id:
                    events_by_id[event_id] = astro_event
                    new_events_count += 1
            
            # Pagination: Move to next page if we haven't hit the cutoff
            if keep_fetching:
                links = data.get("links", {})
                url = links.get("next")
            else:
                url = None
                
        except Exception as e:
            print(f"Error fetching from GraceDB API: {e}")
            break

    print(f"Found {new_events_count} new unique events from GraceDB.")
    
    # 4. Sort and save back to JSON
    if new_events_count > 0:
        def _sort_key(e):
            return e.get("detectionTime") or e.get("createdAt") or ""
            
        all_events = sorted(events_by_id.values(), key=_sort_key, reverse=True)
        
        try:
            with open(HISTORY_JSON, "w", encoding="utf-8") as f:
                json.dump(all_events, f, indent=2, ensure_ascii=False, default=str)
            print(f"Successfully saved {len(all_events)} total events to {HISTORY_JSON.name}")
        except Exception as e:
            print(f"Error writing to {HISTORY_JSON.name}: {e}")


if __name__ == "__main__":
    ingest_gracedb_events(days=120)
