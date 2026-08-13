"""
test_sky_geometry.py
--------------------
Scientific regression tests for the DERIVED sky-geometry calculations in
app.gcn.normalizer.

The critical test here is test_sun_separation_uses_gcrs_frame. get_body()
returns a GEOCENTRIC (GCRS) position carrying a finite distance; taking
.separation() against a distance-less barycentric ICRS coordinate produces an
angle wrong by up to ~150°. That defect shipped silently for a long time
because the warning astropy raised about it was explicitly suppressed.

If someone reintroduces the frame mismatch, test_sun_separation_uses_gcrs_frame
fails loudly instead of quietly corrupting the archive.

Run:  pytest backend/tests/test_sky_geometry.py
"""

import math

import pytest

from app.gcn.normalizer import _ra_dec_to_gal, _sun_moon_distance, _valid_radec


# ---------------------------------------------------------------------------
# The anchor case.
#
# Event 19036 in core.events: RA 237.42°, Dec -28.74°, 2026-06-09T08:23:11Z.
#
# On that date the Sun sits near RA 77.1°, Dec +22.9°. The event is almost
# diametrically opposite in RA, so the separation must be large (~161°).
# Verified independently three ways: astropy scalar, astropy vectorised, and
# a by-hand spherical law of cosines.
#
# The pre-fix ICRS/GCRS-mismatched code returned 12.77° for this same input.
# ---------------------------------------------------------------------------
ANCHOR_RA = 237.42
ANCHOR_DEC = -28.74
ANCHOR_TIME = "2026-06-09T08:23:11Z"
ANCHOR_SUN_SEP = 161.3577
ANCHOR_MOON_SEP = 118.0665
ANCHOR_GAL_L = 343.7294
ANCHOR_GAL_B = 19.6793

# The specific wrong value produced by the ICRS-vs-GCRS frame mismatch.
REGRESSION_WRONG_SUN_SEP = 12.7737


def test_sun_separation_uses_gcrs_frame():
    """Sun separation must be computed with both coordinates in GCRS."""
    sun, _moon = _sun_moon_distance(ANCHOR_RA, ANCHOR_DEC, ANCHOR_TIME)
    assert sun is not None, "anchor case must be computable"
    assert sun == pytest.approx(ANCHOR_SUN_SEP, abs=0.01)
    # Guard the exact historical defect.
    assert sun != pytest.approx(REGRESSION_WRONG_SUN_SEP, abs=0.1), (
        "ICRS/GCRS frame mismatch has been reintroduced in _sun_moon_distance"
    )


def test_sun_separation_matches_hand_calculation():
    """Cross-check the anchor against an independent spherical calculation."""
    sun_ra, sun_dec = math.radians(77.13), math.radians(22.909)
    ev_ra, ev_dec = math.radians(ANCHOR_RA), math.radians(ANCHOR_DEC)
    cos_sep = math.sin(sun_dec) * math.sin(ev_dec) + math.cos(sun_dec) * math.cos(
        ev_dec
    ) * math.cos(ev_ra - sun_ra)
    by_hand = math.degrees(math.acos(max(-1.0, min(1.0, cos_sep))))

    sun, _ = _sun_moon_distance(ANCHOR_RA, ANCHOR_DEC, ANCHOR_TIME)
    # ~0.5° tolerance: the hand calc ignores light-travel/aberration effects.
    assert sun == pytest.approx(by_hand, abs=0.5)


def test_moon_separation_anchor():
    _sun, moon = _sun_moon_distance(ANCHOR_RA, ANCHOR_DEC, ANCHOR_TIME)
    assert moon == pytest.approx(ANCHOR_MOON_SEP, abs=0.05)


def test_separations_within_physical_range():
    """An angular separation on a sphere is always within [0, 180]."""
    for ra in (0.0, 45.0, 180.0, 359.9):
        for dec in (-89.9, -45.0, 0.0, 45.0, 89.9):
            sun, moon = _sun_moon_distance(ra, dec, ANCHOR_TIME)
            assert sun is not None and moon is not None
            assert 0.0 <= sun <= 180.0
            assert 0.0 <= moon <= 180.0


# ---------------------------------------------------------------------------
# UNKNOWN must never be fabricated
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad_time", [None, "", "not-a-timestamp"])
def test_missing_or_bad_time_returns_unknown(bad_time):
    """No timestamp means UNKNOWN, never the old 90.0 placeholder."""
    sun, moon = _sun_moon_distance(ANCHOR_RA, ANCHOR_DEC, bad_time)
    assert sun is None and moon is None


@pytest.mark.parametrize(
    "ra,dec",
    [
        (400.0, 0.0),      # RA out of range
        (-10.0, 0.0),      # negative RA
        (0.0, 120.0),      # Dec out of range
        (0.0, -91.0),      # Dec out of range
        (float("nan"), 0.0),
        (0.0, float("inf")),
        (None, None),
    ],
)
def test_invalid_coordinates_return_unknown(ra, dec):
    assert _sun_moon_distance(ra, dec, ANCHOR_TIME) == (None, None)
    assert _ra_dec_to_gal(ra, dec) == (None, None)


def test_never_returns_the_legacy_90_placeholder():
    """The old failure path returned exactly 90.0/90.0. It must not return."""
    for bad in (None, "garbage"):
        assert _sun_moon_distance(ANCHOR_RA, ANCHOR_DEC, bad) != (90.0, 90.0)


# ---------------------------------------------------------------------------
# Galactic transform
# ---------------------------------------------------------------------------

def test_galactic_transform_anchor():
    l, b = _ra_dec_to_gal(ANCHOR_RA, ANCHOR_DEC)
    assert l == pytest.approx(ANCHOR_GAL_L, abs=0.01)
    assert b == pytest.approx(ANCHOR_GAL_B, abs=0.01)


def test_galactic_centre_maps_to_origin():
    """Sgr A* (ICRS 266.4168°, -29.0078°) is the Galactic origin by definition."""
    l, b = _ra_dec_to_gal(266.4168, -29.0078)
    assert (l < 0.2 or l > 359.8), f"expected l near 0, got {l}"
    assert abs(b) < 0.2, f"expected b near 0, got {b}"


def test_galactic_pole_does_not_divide_by_zero():
    """The old hand-rolled transform divided by cos(b), exploding at b = ±90."""
    l, b = _ra_dec_to_gal(192.8595, 27.1284)  # North Galactic Pole
    assert l is not None and b is not None
    assert b == pytest.approx(90.0, abs=0.05)


def test_galactic_output_ranges():
    for ra in (0.0, 90.0, 200.0, 359.0):
        for dec in (-80.0, 0.0, 80.0):
            l, b = _ra_dec_to_gal(ra, dec)
            assert 0.0 <= l < 360.0
            assert -90.0 <= b <= 90.0


# ---------------------------------------------------------------------------
# Coordinate validator
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ra,dec,ok", [
    (0.0, 0.0, True),
    (359.999, 90.0, True),
    (180.0, -90.0, True),
    (360.0, 0.0, False),
    (0.0, 90.1, False),
    (float("nan"), 0.0, False),
    (float("inf"), 0.0, False),
    ("abc", 0.0, False),
    (None, 0.0, False),
])
def test_valid_radec(ra, dec, ok):
    assert _valid_radec(ra, dec) is ok
