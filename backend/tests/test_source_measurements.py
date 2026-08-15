"""
test_source_measurements.py
---------------------------
Phase 2 regression tests: SOURCE measurements must never be fabricated.

Before these fixes the normalizer coerced every missing measurement to 0.0.
Because (0, 0) is a *valid* sky position and 0 is a plausible-looking SNR,
nothing downstream could distinguish a fabricated value from a real one —
279 of 304 archived events ended up claiming to sit at the celestial origin.

Run:  pytest backend/tests/test_source_measurements.py
"""

import pytest

from app.gcn.normalizer import (
    _measured,
    _positive_measured,
    _safe_float,
    normalize,
)


# ---------------------------------------------------------------------------
# _measured — absent means None, never 0.0
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("val", [None, "", "abc", [], {}, float("nan"), float("inf")])
def test_measured_returns_none_for_unusable(val):
    assert _measured(val) is None


@pytest.mark.parametrize("val,expected", [
    (0, 0.0),          # a genuine zero is preserved
    (0.0, 0.0),
    (12.5, 12.5),
    ("12.5", 12.5),
    (-3.25, -3.25),
])
def test_measured_preserves_real_values(val, expected):
    assert _measured(val) == expected


def test_measured_never_substitutes_zero_for_missing():
    """The exact defect: a missing measurement must not become 0.0."""
    assert _measured(None) is not 0.0  # noqa: F632 - identity is the point
    assert _measured(None) is None
    # _safe_float is the legacy behaviour, retained only where a numeric
    # default is genuinely correct. Confirm the two differ.
    assert _safe_float(None) == 0.0
    assert _measured(None) is None


# ---------------------------------------------------------------------------
# _positive_measured — zero is physically meaningless for SNR / FAR / radius
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("val", [0, 0.0, -1, -0.5, None, "x"])
def test_positive_measured_rejects_non_positive(val):
    assert _positive_measured(val) is None


@pytest.mark.parametrize("val", [0.001, 1, 14.7, 1e-8])
def test_positive_measured_accepts_positive(val):
    assert _positive_measured(val) == float(val)


def test_far_of_zero_is_unknown_not_zero():
    """
    A FAR of exactly 0 Hz would mean 'never a false alarm'. It also produced
    the '1 per Infinity years' text in the UI via an unguarded 1/far.
    """
    assert _positive_measured(0.0) is None


# ---------------------------------------------------------------------------
# normalize() — a parse failure must not emit a fabricated event
# ---------------------------------------------------------------------------

def test_parse_failure_yields_unknown_not_origin():
    """
    An unparseable payload must produce UNKNOWN fields, not an event sitting
    at (0, 0) with SNR 0 — which is what the old base-dict defaults did.
    """
    out = normalize("gcn.notices.chime.frb", {})
    for field in ("ra", "dec", "snr", "far", "errorRadius"):
        assert out[field] is None, f"{field} was fabricated as {out[field]!r}"


def test_parse_failure_yields_no_derived_geometry():
    """Derived geometry must not exist where the position does not."""
    out = normalize("gcn.notices.chime.frb", {})
    for field in ("galLon", "galLat", "sunDistance", "moonDistance"):
        assert out[field] is None


def test_unknown_topic_does_not_fabricate():
    out = normalize("some.unknown.topic", {"nothing": "useful"})
    assert out["ra"] is None and out["dec"] is None
    assert out["snr"] is None and out["far"] is None


def test_real_payload_is_preserved():
    """A payload carrying real values must pass them through unchanged."""
    out = normalize("gcn.notices.chime.frb", {
        "ra": 237.42, "dec": -28.74, "snr": 14.7,
        "far": 3.2e-8, "loc_error": 2.1, "dm": 393.5,
        "timestamp": "2026-06-09T08:23:11Z",
    })
    assert out["ra"] == 237.42
    assert out["dec"] == -28.74
    assert out["snr"] == 14.7
    assert out["far"] == pytest.approx(3.2e-8)
    assert out["errorRadius"] == 2.1
    assert out["dm"] == 393.5


# ---------------------------------------------------------------------------
# IceCube: signalness is not SNR
# ---------------------------------------------------------------------------

def test_icecube_signalness_is_not_stored_as_snr():
    """
    Signalness is a probability in [0,1] that the event is astrophysical.
    SNR is a detection significance in sigma. Storing one as the other made
    cross-messenger SNR comparison meaningless.
    """
    out = normalize("gcn.notices.icecube.gold_bronze_track_alerts", {
        "ra": 100.0, "dec": 20.0, "signalness": 0.87,
        "event_dt": "2026-06-09T08:23:11Z",
    })
    assert out["signalness"] == 0.87
    assert out["snr"] is None, "signalness must not be reported as SNR"


def test_icecube_missing_uncertainty_is_unknown():
    """max(ra_err, dec_err) must not become 0 when neither is reported."""
    out = normalize("gcn.notices.icecube.gold_bronze_track_alerts", {
        "ra": 100.0, "dec": 20.0, "event_dt": "2026-06-09T08:23:11Z",
    })
    assert out["errorRadius"] is None
