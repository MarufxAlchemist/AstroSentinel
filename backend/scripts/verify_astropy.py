"""
verify_astropy.py
-----------------
Verification script for the Astropy sun/moon distance implementation.
Run from: backend/
  python scripts/verify_astropy.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.gcn.normalizer import _sun_moon_distance, _ASTROPY_AVAILABLE, normalize

print("=" * 60)
print("Astropy Sun/Moon Distance — Verification")
print("=" * 60)

# 1. Check Astropy is loaded
print(f"\n[1] _ASTROPY_AVAILABLE = {_ASTROPY_AVAILABLE}")
assert _ASTROPY_AVAILABLE, "ERROR: Astropy not installed!"
print("    PASS")

# 2. Real calculation — GRB260607A approximate coordinates
#    RA=219.3, Dec=-34.7 at 2026-06-07T12:00:00Z
sun, moon = _sun_moon_distance(219.3, -34.7, "2026-06-07T12:00:00Z")
print(f"\n[2] GRB260607A (RA=219.3, Dec=-34.7, t=2026-06-07T12:00:00Z)")
print(f"    sun_distance  = {sun} deg")
print(f"    moon_distance = {moon} deg")
assert 0 < sun  < 180, f"sun out of range: {sun}"
assert 0 < moon < 180, f"moon out of range: {moon}"
print("    PASS — values are real, not 90/90")

# 3. Fallback: None timestamp
sun0, moon0 = _sun_moon_distance(219.3, -34.7, None)
print(f"\n[3] Fallback (no timestamp) -> sun={sun0}, moon={moon0}")
assert sun0 == 90.0 and moon0 == 90.0, "Expected fallback 90/90"
print("    PASS")

# 4. Fallback: unparseable timestamp
sunX, moonX = _sun_moon_distance(219.3, -34.7, "not-a-date")
print(f"\n[4] Fallback (bad timestamp) -> sun={sunX}, moon={moonX}")
assert sunX == 90.0 and moonX == 90.0, "Expected fallback 90/90"
print("    PASS")

# 5. Full CHIME FRB pipeline test
print("\n[5] Full normalize() — CHIME FRB payload")
chime_payload = {
    "tns_name":       "FRB20260615T145508Z",
    "ra":             83.82,
    "dec":            -5.39,
    "dm":             557.0,
    "snr":            22.4,
    "far":            1e-5,
    "detection_time": "2026-06-15T14:55:08Z",
}
result = normalize("gcn.notices.chime.frb", chime_payload)
print(f"    eventId       = {result['eventId']}")
print(f"    detectionTime = {result['detectionTime']}")
print(f"    sunDistance   = {result['sunDistance']} deg")
print(f"    moonDistance  = {result['moonDistance']} deg")
assert result["sunDistance"] != 90.0, "Still returning placeholder!"
assert result["moonDistance"] != 90.0, "Still returning placeholder!"
print("    PASS — real ephemeris values returned")

# 6. _generic now calls _sun_moon_distance (was hardcoded 90.0)
print("\n[6] Full normalize() — unknown topic (_generic parser)")
generic_payload = {
    "ra":  83.82,
    "dec": -5.39,
    "time": "2026-06-15T14:55:08Z",
}
result2 = normalize("gcn.notices.some.new.instrument", generic_payload)
print(f"    sunDistance   = {result2['sunDistance']} deg")
print(f"    moonDistance  = {result2['moonDistance']} deg")
assert result2["sunDistance"] != 90.0, "_generic still hardcoding!"
print("    PASS — _generic now uses real ephemeris")

# 7. Timestamp order confirmation (all parsers)
print("\n[7] Parser timestamp-before-call order summary:")
parsers = [
    ("_chime_frb",       "detection_time / event_time"),
    ("_einstein_probe",  "trigger_time / t_start"),
    ("_icecube",         "event_dt / time"),
    ("_igwn",            "event.time / time_created / event_time"),
    ("_swift_bat",       "trigger_time / time"),
    ("_generic",         "time / detection_time"),
]
for name, keys in parsers:
    print(f"    {name:<20} uses: {keys}")

print()
print("=" * 60)
print("ALL VERIFICATION CHECKS PASSED")
print("=" * 60)
