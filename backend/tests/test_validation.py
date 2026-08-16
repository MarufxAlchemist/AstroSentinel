"""
test_validation.py
------------------
Phase 3 tests: scientific validation, diagnostics and the quality score.

Two properties matter most and are asserted repeatedly:

  1. Validation NEVER rejects or mutates an event. It only describes.
  2. The quality score never contradicts its own validation status — a
     headline number that reads well while the verdict is FAIL would train
     researchers to ignore the panel.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.science.diagnostics import Level, ValidationReport
from app.science.quality import FAIL_SCORE_CAP, WEIGHTS, score_quality
from app.science.validators import validate_event

PAST = "2026-08-10T10:00:00Z"


def ev(**over):
    base = {
        "eventId": "TEST0001A",
        "eventType": "FRB",
        "observatory": "CHIME",
        "detectionTime": PAST,
        "ra": 100.0, "dec": 20.0,
        "snr": 12.0, "far": 1e-7, "errorRadius": 2.0,
        # A radius without a stated containment convention is only half a
        # measurement (spec section 23), so a genuinely clean event states it.
        "errorRadiusContainment": "90_2D",
        # DM is the defining FRB observable — an FRB without one is not a
        # "clean" event, and the messenger validator rightly flags it.
        "dm": 500.0,
        "galLon": 200.0, "galLat": 10.0,
        "sunDistance": 90.0, "moonDistance": 90.0,
    }
    base.update(over)
    return base


def codes(e):
    return set(validate_event(e).codes())


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------

def test_validation_does_not_mutate_the_event():
    e = ev()
    before = dict(e)
    validate_event(e)
    assert e == before


def test_clean_event_produces_no_findings_against_the_data():
    """
    INFO diagnostics are legitimate output (e.g. "redshift not derived from
    DM" records a deliberate refusal). "Clean" means nothing at WARNING or
    above, not silence.
    """
    rep = validate_event(ev())
    assert rep.status == "PASS"
    assert [d.code for d in rep.diagnostics if d.level >= Level.WARNING] == []


def test_a_failing_validator_cannot_break_validation():
    """One bad rule must not suppress the others (spec section 48)."""
    import app.science.validators as V

    def boom(_e, _r):
        raise RuntimeError("simulated")

    original = V.CHECKS
    V.CHECKS = (boom,) + original
    try:
        rep = validate_event(ev())
        assert rep.has("validator_failed")
        assert rep.worst == Level.CRITICAL
    finally:
        V.CHECKS = original


# ---------------------------------------------------------------------------
# Coordinates
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ra,dec,code", [
    (400.0, 20.0, "ra_out_of_range"),
    (-5.0, 20.0, "ra_out_of_range"),
    (100.0, 121.4, "dec_out_of_range"),
    (100.0, -91.0, "dec_out_of_range"),
])
def test_out_of_range_coordinates_are_errors(ra, dec, code):
    assert code in codes(ev(ra=ra, dec=dec))


def test_missing_position_is_flagged():
    assert "position_missing" in codes(ev(ra=None, dec=None, galLon=None, galLat=None,
                                          sunDistance=None, moonDistance=None))


def test_half_missing_position_is_an_error():
    assert "position_half_missing" in codes(ev(dec=None))


def test_null_island_is_flagged_but_not_an_error():
    rep = validate_event(ev(ra=0.0, dec=0.0))
    assert rep.has("position_at_origin")
    assert rep.status == "WARNING"     # suspicious, not impossible


def test_derived_without_position_is_an_error():
    """The exact corruption Phases 1-2 removed must be detectable."""
    e = ev(ra=None, dec=None)          # keeps galLon/sunDistance populated
    c = codes(e)
    assert "derived_without_position" in c


@pytest.mark.parametrize("field", ["galLon", "galLat"])
def test_galactic_out_of_range(field):
    bad = {"galLon": 400.0, "galLat": 95.0}[field]
    assert any("out_of_range" in c for c in codes(ev(**{field: bad})))


@pytest.mark.parametrize("sep", [-1.0, 181.0, 999.0])
def test_separation_out_of_physical_range(sep):
    assert "sunDistance_out_of_range" in codes(ev(sunDistance=sep))


def test_sun_constraint_is_a_notice_not_an_error():
    rep = validate_event(ev(sunDistance=5.0))
    assert rep.has("sun_constraint")
    assert rep.status == "PASS"        # NOTICE does not degrade status


# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------

def test_future_detection_time_is_an_error():
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    assert "detection_time_future" in codes(ev(detectionTime=future))


def test_small_clock_skew_is_tolerated():
    skew = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
    assert "detection_time_future" not in codes(ev(detectionTime=skew))


def test_ancient_detection_time_is_an_error():
    assert "detection_time_ancient" in codes(ev(detectionTime="1970-01-01T00:00:00Z"))


@pytest.mark.parametrize("bad", [None, "", "not-a-time"])
def test_unparseable_time(bad):
    assert "detection_time_unparseable" in codes(ev(detectionTime=bad))


def test_negative_latency_is_an_error():
    assert "latency_negative" in codes(ev(latencyUs=-5))


# ---------------------------------------------------------------------------
# Measurements
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field,code", [
    ("snr", "snr_non_positive"),
    ("far", "far_non_positive"),
    ("errorRadius", "error_radius_non_positive"),
])
def test_non_positive_measurements_are_errors(field, code):
    assert code in codes(ev(**{field: 0.0}))
    assert code in codes(ev(**{field: -1.0}))


@pytest.mark.parametrize("field,code", [
    ("snr", "snr_missing"),
    ("far", "far_missing"),
    ("errorRadius", "error_radius_missing"),
])
def test_missing_measurements_are_warnings_not_errors(field, code):
    rep = validate_event(ev(**{field: None}))
    assert rep.has(code)
    assert rep.status == "WARNING"


def test_missing_snr_is_only_info_for_neutrinos():
    """IceCube reports signalness, not SNR — absence is expected, not a gap."""
    rep = validate_event(ev(eventType="NU", snr=None))
    assert rep.has("snr_not_applicable")
    assert not rep.has("snr_missing")


@pytest.mark.parametrize("val", [-0.5, 1.5, 2.0])
def test_signalness_outside_probability_range(val):
    assert "signalness_out_of_range" in codes(ev(eventType="NU", signalness=val))


@pytest.mark.parametrize("field", ["fluence", "dm", "chirpMass", "luminosityDistance"])
def test_negative_physical_quantities(field):
    assert f"{field}_negative" in codes(ev(**{field: -1.0}))


# ---------------------------------------------------------------------------
# Cross-field
# ---------------------------------------------------------------------------

def test_dm_on_a_grb_is_suspicious():
    assert "field_unexpected_for_type" in codes(ev(eventType="GRB", dm=500.0))


def test_chirp_mass_on_an_frb_is_suspicious():
    assert "field_unexpected_for_type" in codes(ev(eventType="FRB", chirpMass=1.4))


def test_fluence_without_band_is_a_notice():
    rep = validate_event(ev(eventType="GRB", fluence=1e-6, fluenceBand=None, snr=10.0))
    assert rep.has("fluence_band_missing")


# ---------------------------------------------------------------------------
# Source sanitization — impossible values must not look like absence
# ---------------------------------------------------------------------------

def test_impossible_source_value_is_distinguished_from_absence():
    """
    The normalizer discards an impossible SNR. Without this check the result is
    indistinguishable from a notice that simply omitted SNR — a broken notice
    would be silently laundered into a benign gap.
    """
    e = ev(snr=None, raw={"snr": -5.0})
    c = codes(e)
    assert "source_value_impossible" in c
    assert "snr_missing" in c          # both facts reported


def test_unparseable_source_value_is_reported():
    e = ev(snr=None, raw={"snr": "abc"})
    assert "source_value_unparseable" in codes(e)


def test_plain_absence_produces_no_sanitization_finding():
    e = ev(snr=None, raw={})
    c = codes(e)
    assert "source_value_impossible" not in c
    assert "snr_missing" in c


def test_zero_is_allowed_where_physically_meaningful():
    """DM of 0 is unusual but not impossible; it must not be flagged."""
    e = ev(dm=0.0, raw={"dm": 0.0})
    assert "source_value_impossible" not in codes(e)


# ---------------------------------------------------------------------------
# Quality score
# ---------------------------------------------------------------------------

def test_weights_sum_to_100():
    assert sum(WEIGHTS.values()) == 100


def test_clean_event_scores_100():
    e = ev()
    q = score_quality(e, validate_event(e))
    assert q["overall"] == 100
    assert q["grade"] == "PASS"


def test_score_never_contradicts_a_fail_verdict():
    """An impossible value must not grade above FAIL, however healthy the rest."""
    e = ev(dec=121.4)
    rep = validate_event(e)
    q = score_quality(e, rep)
    assert rep.status == "FAIL"
    assert q["grade"] == "FAIL"
    assert q["overall"] <= FAIL_SCORE_CAP


def test_score_never_reads_pass_while_warning():
    e = ev(ra=0.0, dec=0.0)
    rep = validate_event(e)
    q = score_quality(e, rep)
    assert rep.status == "WARNING"
    assert q["grade"] != "PASS"


def test_empty_event_scores_poorly():
    """
    Regression: an event with no position and no measurements scored 81
    "PARTIAL" because components with nothing to check were credited 100.
    """
    e = {"eventId": "X", "eventType": "FRB", "observatory": "CHIME",
         "detectionTime": PAST}
    q = score_quality(e, validate_event(e))
    assert q["overall"] < 60
    assert q["components"]["coordinate_validity"]["score"] == 0


def test_components_with_no_evidence_are_not_credited():
    e = {"eventId": "X", "eventType": "FRB", "observatory": "CHIME",
         "detectionTime": PAST, "ra": 10.0, "dec": 10.0}
    q = score_quality(e, validate_event(e))
    assert q["components"]["physical_validity"]["applicable"] is False
    assert q["components"]["physical_validity"]["score"] is None
    assert q["effectiveWeight"] < 100


def test_missing_position_floors_coordinate_validity():
    e = {"eventId": "X", "eventType": "FRB", "observatory": "CHIME",
         "detectionTime": PAST, "snr": 10.0, "far": 1e-7, "errorRadius": 1.0}
    q = score_quality(e, validate_event(e))
    assert q["components"]["coordinate_validity"]["score"] == 0


def test_missing_identity_is_penalised():
    e = ev(eventId=None)
    q = score_quality(e, validate_event(e))
    assert q["components"]["source_integrity"]["score"] == 0


def test_every_deduction_is_itemised():
    """Any number shown to a researcher must be traceable to its rules."""
    e = ev(snr=None, far=None)
    q = score_quality(e, validate_event(e))
    ded = q["components"]["completeness"]["deductions"]
    assert ded and all("code" in d and "reason" in d for d in ded)
