"""
test_revisions.py
-----------------
Phase 6 tests: scientific delta detection between notices (spec 27-28).

The assertion this file exists for is the distinction between a *refinement*
and an *inconsistency*. A position that moves within its own error bars is
routine; one that moves far outside them means the notices disagree, and
reporting both as "position updated" hides a real failure behind a routine
label.

The other recurring theme is that losing information is never an improvement:
a revision that stops reporting a localization, or drops a measurement, is a
loss of knowledge and is reported as one.
"""

import math

import pytest

from app.science.diagnostics import Level
from app.science.revisions import (
    POSITION_INCONSISTENT_SIGMA,
    angular_separation_deg,
    compare_revisions,
    snapshot,
)


def base(**over):
    e = {
        "eventId": "S260101a", "eventType": "GW", "observatory": "LVK",
        "detectionTime": "2026-08-10T10:00:00Z",
        "ra": 100.0, "dec": 20.0,
        "errorRadius": 60.0, "errorRadiusContainment": "90_2D",
        "snr": 12.0, "far": 1e-7,
        "lifecycle": "preliminary", "isRetraction": False,
    }
    e.update(over)
    return e


def codes(prev, curr):
    return set(compare_revisions(prev, curr).codes())


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

class TestSeparation:

    def test_pure_declination_shift(self):
        assert angular_separation_deg(10, 0, 10, 1) == pytest.approx(1.0)

    def test_ra_shift_shrinks_with_declination(self):
        """1 degree of RA at dec = 60 is half a degree on the sky."""
        assert angular_separation_deg(10, 60, 11, 60) == pytest.approx(0.5, abs=1e-4)

    def test_ra_wraparound(self):
        """359.5 -> 0.5 is one degree apart, not 359."""
        assert angular_separation_deg(359.5, 0, 0.5, 0) == pytest.approx(1.0, abs=1e-6)

    def test_antipodal(self):
        assert angular_separation_deg(0, 90, 0, -90) == pytest.approx(180.0)

    def test_identical_positions(self):
        assert angular_separation_deg(123.4, -56.7, 123.4, -56.7) == 0.0

    def test_small_separation_precision(self):
        """Haversine keeps precision at the arcsecond scale, where cosine fails."""
        got = angular_separation_deg(100.0, 20.0, 100.0, 20.0 + 1 / 3600)
        assert got == pytest.approx(1 / 3600, rel=1e-6)


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------

class TestContract:

    def test_no_changes_produces_no_deltas(self):
        rep = compare_revisions(base(), base())
        assert rep.deltas == []
        assert rep.significance == "NONE"

    def test_comparison_does_not_mutate_either_revision(self):
        a, b = base(), base(ra=101.0)
        a0, b0 = dict(a), dict(b)
        compare_revisions(a, b)
        assert a == a0 and b == b0

    def test_a_failing_check_does_not_suppress_the_others(self, monkeypatch):
        import app.science.revisions as R

        def boom(_p, _c, _r):
            raise RuntimeError("simulated")

        monkeypatch.setattr(R, "CHECKS", (boom,) + R.CHECKS)
        rep = compare_revisions(base(), base(isRetraction=True))
        assert rep.has("revision_check_failed")
        assert rep.has("revision_retracted")      # the real finding survived


# ---------------------------------------------------------------------------
# Position: refinement vs inconsistency — the core of this phase
# ---------------------------------------------------------------------------

class TestPosition:

    def test_shift_within_uncertainty_is_a_refinement(self):
        # 60 arcmin at 90% containment -> 0.466 deg 1-sigma-equivalent.
        rep = compare_revisions(base(), base(ra=100.3))
        assert rep.has("revision_position_refined")
        assert not rep.has("revision_position_inconsistent")
        assert rep.significance == "ROUTINE"

    def test_shift_far_outside_uncertainty_is_an_error(self):
        """The failure a bare 'position updated' label would have hidden."""
        rep = compare_revisions(base(), base(ra=140.0))
        assert rep.has("revision_position_inconsistent")
        assert rep.significance == "CRITICAL"
        d = next(x for x in rep.deltas if x.code == "revision_position_inconsistent")
        assert d.level >= Level.ERROR
        assert d.magnitude > POSITION_INCONSISTENT_SIGMA

    def test_the_boundary_is_the_combined_uncertainty(self):
        """Tightening the error bars can turn a refinement into a disagreement."""
        loose = compare_revisions(base(errorRadius=600.0), base(ra=105.0, errorRadius=600.0))
        tight = compare_revisions(base(errorRadius=1.0), base(ra=105.0, errorRadius=1.0))
        assert loose.has("revision_position_refined")
        assert tight.has("revision_position_inconsistent")

    def test_containment_convention_is_used_in_the_significance(self):
        """
        The same radius means different things under different conventions, so
        the sigma count must differ. 90% containment is 2.146 sigma in 2-D, so
        a 90%-quoted radius implies a SMALLER 1-sigma and a larger discrepancy.
        """
        a = compare_revisions(base(errorRadiusContainment="90_2D"),
                              base(ra=101.0, errorRadiusContainment="90_2D"))
        b = compare_revisions(base(errorRadiusContainment="1SIGMA_1D"),
                              base(ra=101.0, errorRadiusContainment="1SIGMA_1D"))
        ma = next(x for x in a.deltas if x.code.startswith("revision_position_")).magnitude
        mb = next(x for x in b.deltas if x.code.startswith("revision_position_")).magnitude
        assert ma > mb

    def test_unstated_conventions_are_caveated_not_assumed(self):
        rep = compare_revisions(base(errorRadiusContainment=None),
                                base(ra=140.0, errorRadiusContainment=None))
        d = next(x for x in rep.deltas if x.code == "revision_position_inconsistent")
        assert "not stated" in d.message
        assert "indicative rather than exact" in d.message

    def test_without_any_uncertainty_the_verdict_is_withheld(self):
        rep = compare_revisions(base(errorRadius=None), base(ra=140.0, errorRadius=None))
        d = next(x for x in rep.deltas if x.code == "revision_position_moved")
        assert "cannot be determined" in d.message
        assert not rep.has("revision_position_refined")
        assert not rep.has("revision_position_inconsistent")

    def test_a_tiny_shift_without_uncertainty_is_only_info(self):
        rep = compare_revisions(base(errorRadius=None), base(ra=100.001, errorRadius=None))
        d = next(x for x in rep.deltas if x.code == "revision_position_moved")
        assert d.level == Level.INFO

    def test_losing_the_position_is_a_warning_not_a_refinement(self):
        rep = compare_revisions(base(), base(ra=None, dec=None))
        assert rep.has("revision_position_lost")
        assert not rep.has("revision_position_refined")

    def test_gaining_a_position_is_reported(self):
        assert "revision_position_gained" in codes(base(ra=None, dec=None), base())


# ---------------------------------------------------------------------------
# Localization
# ---------------------------------------------------------------------------

class TestLocalization:

    def test_tightening_is_an_improvement(self):
        rep = compare_revisions(base(errorRadius=60.0), base(errorRadius=6.0))
        assert rep.has("revision_localization_improved")

    def test_widening_warns_that_earlier_follow_up_may_miss(self):
        rep = compare_revisions(base(errorRadius=6.0), base(errorRadius=60.0))
        d = next(x for x in rep.deltas if x.code == "revision_localization_degraded")
        assert "may no longer cover the source" in d.message

    def test_a_convention_change_refuses_the_comparison(self):
        """
        A source switching 1-sigma -> 90% would look like a 2.15x degradation
        that is purely an artefact of the convention.
        """
        rep = compare_revisions(base(errorRadiusContainment="1SIGMA_1D"),
                                base(errorRadius=128.8, errorRadiusContainment="90_2D"))
        assert rep.has("revision_containment_changed")
        assert not rep.has("revision_localization_improved")
        assert not rep.has("revision_localization_degraded")

    def test_losing_the_localization_is_never_an_improvement(self):
        """The exact inversion found in the notification changeDetector."""
        rep = compare_revisions(base(errorRadius=60.0), base(errorRadius=None))
        assert rep.has("revision_localization_lost")
        assert not rep.has("revision_localization_improved")
        d = next(x for x in rep.deltas if x.code == "revision_localization_lost")
        assert "not a perfect localization" in d.message

    def test_small_changes_are_not_reported(self):
        assert not compare_revisions(base(errorRadius=60.0),
                                     base(errorRadius=58.0)).has(
            "revision_localization_improved")


# ---------------------------------------------------------------------------
# Retraction and classification
# ---------------------------------------------------------------------------

class TestRetractionAndClassification:

    def test_retraction_is_critical(self):
        rep = compare_revisions(base(), base(isRetraction=True))
        assert rep.has("revision_retracted")
        assert rep.significance == "CRITICAL"

    def test_retraction_message_reaches_derived_and_correlations(self):
        rep = compare_revisions(base(), base(isRetraction=True))
        d = next(x for x in rep.deltas if x.code == "revision_retracted")
        assert "derived" in d.message and "correlation" in d.message

    def test_un_retraction_is_flagged(self):
        assert "revision_unretracted" in codes(base(isRetraction=True), base())

    def test_messenger_type_change_is_an_error(self):
        rep = compare_revisions(base(eventType="GW"), base(eventType="GRB"))
        assert rep.has("revision_event_type_changed")
        assert rep.significance == "CRITICAL"

    def test_lifecycle_advance_is_routine(self):
        rep = compare_revisions(base(lifecycle="preliminary"), base(lifecycle="confirmed"))
        assert rep.has("revision_lifecycle_advanced")
        assert rep.significance == "ROUTINE"

    def test_tier_change_is_noticed(self):
        assert "revision_classification_changed" in codes(
            base(classificationTier="BRONZE"), base(classificationTier="GOLD"))


# ---------------------------------------------------------------------------
# Significance and measurements
# ---------------------------------------------------------------------------

class TestSignificance:

    def test_far_worsening_by_orders_of_magnitude_warns(self):
        rep = compare_revisions(base(far=1e-9), base(far=1e-6))
        d = next(x for x in rep.deltas if x.code == "revision_far_worsened")
        assert "less significant" in d.message
        assert rep.significance == "NOTABLE"

    def test_far_improving_is_a_notice(self):
        assert "revision_far_improved" in codes(base(far=1e-6), base(far=1e-9))

    def test_small_far_changes_are_ignored(self):
        c = codes(base(far=1e-7), base(far=2e-7))
        assert "revision_far_worsened" not in c and "revision_far_improved" not in c

    def test_large_snr_change_is_reported(self):
        assert "revision_snr_changed" in codes(base(snr=12.0), base(snr=30.0))


class TestMeasurements:

    def test_dropped_measurements_are_reported(self):
        rep = compare_revisions(base(chirpMass=1.4), base(chirpMass=None))
        d = next(x for x in rep.deltas if x.code == "revision_measurements_lost")
        assert "chirpMass" in d.message
        assert "UNKNOWN rather than retaining their previous values" in d.message

    def test_added_measurements_are_reported(self):
        assert "revision_measurements_gained" in codes(base(), base(chirpMass=1.4))

    def test_position_is_not_double_reported(self):
        """Position has its own richer check; it must not also appear as 'lost'."""
        rep = compare_revisions(base(), base(ra=None, dec=None))
        lost = [d for d in rep.deltas if d.code == "revision_measurements_lost"]
        assert all("ra" not in (d.previous or []) for d in lost)


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------

class TestSnapshot:

    def test_snapshot_keeps_the_scientific_fields(self):
        s = snapshot(base())
        for f in ("ra", "dec", "errorRadius", "errorRadiusContainment", "far", "eventType"):
            assert f in s

    def test_absent_values_are_omitted_not_zeroed(self):
        s = snapshot(base(snr=None, chirpMass=None))
        assert "snr" not in s and "chirpMass" not in s

    def test_a_snapshot_round_trips_through_comparison(self):
        a, b = snapshot(base()), snapshot(base(ra=140.0))
        assert "revision_position_inconsistent" in set(compare_revisions(a, b).codes())
