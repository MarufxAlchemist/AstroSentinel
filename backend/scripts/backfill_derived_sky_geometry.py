"""
backfill_derived_sky_geometry.py
--------------------------------
Recompute the DERIVED sky-geometry columns on core.events from their source
measurements (ra, dec, detection_time) using Astropy.

WHY
───
Prior to migration 0010, `_sun_moon_distance()` in the GCN normalizer returned
a fabricated 90.0/90.0 whenever the ephemeris calculation could not be run
(missing timestamp, Astropy unavailable, or any exception). Those fabricated
values were persisted as NOT NULL and are now indistinguishable from genuine
~90° separations by inspection alone.

This script does not try to guess which stored values were fabricated. It
recomputes every row from its own source coordinates and timestamp, which is
authoritative regardless of what is currently stored. Rows whose *inputs* are
missing or physically invalid are set to NULL (UNKNOWN) rather than any
placeholder.

Galactic coordinates are likewise recomputed: they were previously produced by
a hand-rolled IAU 1958 approximation documented as accurate only to ~0.01°,
which also divided by zero at b = ±90°.

PROVENANCE
──────────
  gal_lon / gal_lat  : DERIVED — ICRS → Galactic, astropy.coordinates.SkyCoord
  sun_distance       : DERIVED — astropy.coordinates.get_body("sun",  t)
  moon_distance      : DERIVED — astropy.coordinates.get_body("moon", t)
  evaluated at       : core.events.detection_time (UTC)

USAGE
─────
  python backfill_derived_sky_geometry.py            # dry run, writes nothing
  python backfill_derived_sky_geometry.py --apply    # commit the update

Requires DATABASE_URL in the environment or in the repo-root .env.
"""

from __future__ import annotations

import math
import os
import sys
from datetime import timezone
from pathlib import Path

import psycopg2
import psycopg2.extras

from astropy.coordinates import GCRS, SkyCoord, get_body
from astropy.time import Time
import astropy.units as u

APPLY = "--apply" in sys.argv


def load_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL not set and not found in repo-root .env")


def valid_radec(ra, dec) -> bool:
    """Mirror of normalizer._valid_radec — finite and inside physical ranges."""
    try:
        ra_f, dec_f = float(ra), float(dec)
    except (TypeError, ValueError):
        return False
    if math.isnan(ra_f) or math.isnan(dec_f) or math.isinf(ra_f) or math.isinf(dec_f):
        return False
    return 0.0 <= ra_f < 360.0 and -90.0 <= dec_f <= 90.0


def main() -> None:
    conn = psycopg2.connect(load_database_url())
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    cur.execute(
        """
        SELECT id, ra, dec, detection_time,
               gal_lon, gal_lat, sun_distance, moon_distance
        FROM core.events
        ORDER BY id
        """
    )
    rows = cur.fetchall()
    print(f"Loaded {len(rows)} events from core.events")

    computable, unknown = [], []
    for r in rows:
        if valid_radec(r["ra"], r["dec"]) and r["detection_time"] is not None:
            computable.append(r)
        else:
            unknown.append(r)

    print(f"  computable (valid ra/dec + timestamp): {len(computable)}")
    print(f"  UNKNOWN    (missing/invalid inputs)  : {len(unknown)}")

    updates: list[tuple] = []

    if computable:
        # Vectorised: one ephemeris evaluation for the whole batch.
        coords = SkyCoord(
            ra=[float(r["ra"]) for r in computable] * u.deg,
            dec=[float(r["dec"]) for r in computable] * u.deg,
            frame="icrs",
        )
        # psycopg2 returns tz-aware datetimes in the session timezone (e.g.
        # +05:30). Astropy Time(scale="utc") needs genuine UTC — converting
        # explicitly, otherwise every ephemeris is evaluated at the wrong
        # instant and the separations are silently wrong.
        times = Time(
            [
                r["detection_time"].astimezone(timezone.utc).replace(tzinfo=None)
                for r in computable
            ],
            scale="utc",
        )
        gal = coords.galactic
        # Transform into GCRS at each observation epoch before separating —
        # get_body() returns geocentric positions with finite distance, and
        # mixing those with barycentric ICRS gives angles wrong by up to ~150°.
        coords_gcrs = coords.transform_to(GCRS(obstime=times))
        sun_sep = coords_gcrs.separation(get_body("sun", times))
        moon_sep = coords_gcrs.separation(get_body("moon", times))

        for i, r in enumerate(computable):
            updates.append(
                (
                    round(float(gal.l.deg[i]) % 360.0, 4),
                    round(float(gal.b.deg[i]), 4),
                    round(float(sun_sep.deg[i]), 4),
                    round(float(moon_sep.deg[i]), 4),
                    r["id"],
                )
            )

    for r in unknown:
        updates.append((None, None, None, None, r["id"]))

    # Report what actually changes, focusing on the fabricated-90 signature.
    changed_sun = 0
    was_exactly_90 = 0
    for lon, lat, sun, moon, _id in updates:
        old = next(r for r in rows if r["id"] == _id)
        if old["sun_distance"] is not None and abs(float(old["sun_distance"]) - 90.0) < 1e-9:
            was_exactly_90 += 1
        if sun is None or old["sun_distance"] is None:
            if sun != old["sun_distance"]:
                changed_sun += 1
        elif abs(float(old["sun_distance"]) - sun) > 1e-4:
            changed_sun += 1

    print(f"\nRows currently storing sun_distance == exactly 90.0 : {was_exactly_90}")
    print(f"Rows whose sun_distance will change                 : {changed_sun}")

    if not APPLY:
        print("\nDRY RUN — nothing written. Re-run with --apply to commit.")
        for lon, lat, sun, moon, _id in updates[:5]:
            print(f"  id={_id}: l={lon} b={lat} sun={sun} moon={moon}")
        conn.close()
        return

    psycopg2.extras.execute_batch(
        cur,
        """
        UPDATE core.events
           SET gal_lon = %s, gal_lat = %s, sun_distance = %s, moon_distance = %s
         WHERE id = %s
        """,
        updates,
    )
    conn.commit()
    print(f"\nApplied {len(updates)} row updates.")
    conn.close()


if __name__ == "__main__":
    main()
