"""
backfill_validation.py
----------------------
Run scientific validation AND derivation over every existing event, and
persist both.

New events are validated and derived in the normalizer on the ingestion path.
Rows that predate Phase 3/5 have neither, so this backfills them using the same
code — there is deliberately no second implementation of the rules, because a
backfill that reimplements them would drift from the live path.

Usage:
  python backfill_validation.py            # dry run, writes nothing
  python backfill_validation.py --apply
"""

from __future__ import annotations

import json
import os
import sys
import pathlib
from collections import Counter

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.science import score_quality, validate_event  # noqa: E402
from app.science.derivations import derive_all  # noqa: E402
from app.science.interest import score_interest  # noqa: E402

APPLY = "--apply" in sys.argv

#: DB column -> normalized event key, so validation sees the same shape the
#: normalizer produces.
FIELD_MAP = {
    "event_id": "eventId",
    "event_type": "eventType",
    "observatory": "observatory",
    "ra": "ra",
    "dec": "dec",
    "error_radius": "errorRadius",
    "snr": "snr",
    "far": "far",
    "signalness": "signalness",
    "fluence": "fluence",
    "fluence_band": "fluenceBand",
    "t90": "t90",
    "dm": "dm",
    "peak_flux": "peakFlux",
    "chirp_mass": "chirpMass",
    "luminosity_distance": "luminosityDistance",
    "gal_lat": "galLat",
    "gal_lon": "galLon",
    "sun_distance": "sunDistance",
    "moon_distance": "moonDistance",
    "redshift": "redshift",
    # Phase 5 localization semantics and uncertainties.
    "error_radius_containment": "errorRadiusContainment",
    "area_50_deg2": "area50Deg2",
    "area_90_deg2": "area90Deg2",
    "luminosity_distance_error": "luminosityDistanceError",
    "redshift_error": "redshiftError",
}


def load_db_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env = pathlib.Path(__file__).resolve().parents[2] / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL not found")


def to_event(row: dict) -> dict:
    ev = {key: row[col] for col, key in FIELD_MAP.items()}
    dt = row["detection_time"]
    ev["detectionTime"] = dt.isoformat() if dt else None
    ev["latencyUs"] = row["latency_us"]
    # No raw payload retained for historical rows; sanitization checks simply
    # find nothing to inspect rather than reporting a false finding.
    ev["raw"] = None
    return ev


def _tally_derived(derived: dict, known: Counter, unknown: Counter) -> None:
    """Count how many events each derived quantity was actually derivable for."""
    for group, block in derived.items():
        if not isinstance(block, dict):
            continue
        for name, q in block.items():
            if not isinstance(q, dict) or "provenance" not in q:
                continue
            label = f"{group}.{name}"
            if q.get("value") is None:
                unknown[label] += 1
            else:
                known[label] += 1


def main() -> None:
    conn = psycopg2.connect(load_db_url())
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cols = ", ".join(FIELD_MAP) + ", id, detection_time, latency_us"
    cur.execute(f"SELECT {cols} FROM core.events ORDER BY id")
    rows = cur.fetchall()
    print(f"Loaded {len(rows)} events")

    updates = []
    statuses: Counter[str] = Counter()
    grades: Counter[str] = Counter()
    codes: Counter[str] = Counter()
    scores: list[int] = []
    derivation_errors: Counter[str] = Counter()
    derived_known: Counter[str] = Counter()
    derived_unknown: Counter[str] = Counter()
    bands: Counter[str] = Counter()
    interest_scores: list[int] = []

    for r in rows:
        ev = to_event(r)
        rep = validate_event(ev)
        q = score_quality(ev, rep)
        v = rep.to_dict()
        statuses[v["status"]] += 1
        grades[q["grade"]] += 1
        scores.append(q["overall"])
        for d in v["diagnostics"]:
            codes[d["code"]] += 1
        derived = derive_all(ev)
        for name, block in derived.items():
            if isinstance(block, dict) and "error" in block:
                derivation_errors[name] += 1
        _tally_derived(derived, derived_known, derived_unknown)
        interest = score_interest(ev)
        bands[interest["band"]] += 1
        interest_scores.append(interest["score"])
        updates.append((json.dumps(v), json.dumps(q), q["overall"], v["status"],
                        json.dumps(derived), json.dumps(interest),
                        interest["score"], r["id"]))

    print("\nvalidation status:", dict(statuses))
    print("quality grade    :", dict(grades))
    if scores:
        print(f"score            : min={min(scores)} median={sorted(scores)[len(scores)//2]} max={max(scores)}")
    print("\nmost common findings:")
    for code, n in codes.most_common(12):
        print(f"   {n:4d}  {code}")

    # The derivation summary is deliberately two-sided. A quantity that could
    # not be derived is a result, not a gap in the report: it tells a
    # researcher exactly which inputs the archive is missing.
    print("\nderived quantities (derivable / UNKNOWN):")
    for name in sorted(set(derived_known) | set(derived_unknown)):
        print(f"   {derived_known[name]:4d} / {derived_unknown[name]:4d}  {name}")
    if derivation_errors:
        print("\nDERIVATION ERRORS:", dict(derivation_errors))

    # Research interest is reported separately from quality on purpose: they
    # answer different questions and are expected to disagree.
    print("\nresearch interest band:", dict(bands))
    if interest_scores:
        srt = sorted(interest_scores)
        print(f"interest score       : min={srt[0]} "
              f"median={srt[len(srt) // 2]} max={srt[-1]}")

    if not APPLY:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        conn.close()
        return

    psycopg2.extras.execute_batch(
        cur,
        """UPDATE core.events
              SET validation = %s::jsonb, quality = %s::jsonb,
                  quality_score = %s, validation_status = %s,
                  derived = %s::jsonb,
                  research_interest = %s::jsonb, interest_score = %s
            WHERE id = %s""",
        updates,
    )
    conn.commit()
    print(f"\nApplied {len(updates)} updates.")
    conn.close()


if __name__ == "__main__":
    main()
