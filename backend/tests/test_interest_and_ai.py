"""
test_interest_and_ai.py
-----------------------
Phase 7 tests: research interest (spec 44) and AI guardrails (spec 40-43).

The assertions that carry the weight here:

  * An UNKNOWN must never add interest. Absence of a measurement is not
    evidence of anything, and an event with no FAR is not "maximally
    significant by default".

  * The AI context must never contain an invented number. The regression being
    guarded is the `?? 0` shape that presented an unlocalized event as sitting
    at RA = 0, Dec = 0 and an event with no false-alarm rate as having
    FAR = 0 Hz — which reads as infinite significance, not as unknown.

  * The three scores answer three different questions and must be able to
    diverge.
"""

import pytest

from app.science.ai_context import (
    CONTEXT_RULES,
    build_context,
    verify_output,
)
from app.science.interest import (
    DISCLAIMER,
    MAX_SCORE,
    score_interest,
)


def ev(etype="GRB", **over):
    e = {"eventId": "T1", "eventType": etype, "observatory": "Obs",
         "detectionTime": "2026-08-10T10:00:00Z"}
    e.update(over)
    return e


# ===========================================================================
# Research interest (spec section 44)
# ===========================================================================

class TestInterestHonesty:

    def test_an_unmeasured_event_scores_only_its_messenger(self):
        """
        The 279-event archive case. Nothing is known, so nothing but the
        messenger baseline can contribute.
        """
        r = score_interest(ev("GRB"))
        assert r["score"] == 10
        assert [c["rule"] for c in r["contributions"]] == ["messenger_rarity"]

    def test_a_missing_far_contributes_nothing_not_everything(self):
        """
        FAR = 0 would mean 'no false alarms ever'. An absent FAR must not be
        treated that way, or an unmeasured event becomes the most significant
        in the archive.
        """
        without = score_interest(ev("GW"))
        assert not any(c["rule"] == "significance" for c in without["contributions"])
        with_far = score_interest(ev("GW", far=1e-10))
        assert with_far["score"] > without["score"]

    def test_a_missing_localization_is_not_a_perfect_one(self):
        r = score_interest(ev("GW"))
        assert not any(c["rule"] == "followup_feasibility" for c in r["contributions"])

    def test_zero_and_negative_measurements_do_not_contribute(self):
        for bad in (0.0, -1.0):
            r = score_interest(ev("GW", far=bad, errorRadius=bad, luminosityDistance=bad))
            rules = [c["rule"] for c in r["contributions"]]
            assert "significance" not in rules
            assert "followup_feasibility" not in rules
            assert "proximity" not in rules

    def test_unassessed_quantities_are_listed(self):
        """A low score must be distinguishable from an unmeasured one."""
        r = score_interest(ev("GW"))
        assert "far" in r["unassessed"]
        assert "localization" in r["unassessed"]
        assert "lower bound" in r["note"]

    def test_a_fully_measured_event_reports_nothing_unassessed(self):
        r = score_interest(ev("GW", far=1e-8, errorRadius=5.0,
                              luminosityDistance=300.0, HasNS=0.1))
        assert r["unassessed"] == []
        assert "All quantities" in r["note"]

    def test_a_retraction_zeroes_the_score(self):
        r = score_interest(ev("GW", far=1e-10, HasNS=0.95,
                              luminosityDistance=100.0, area90Deg2=10.0,
                              isRetraction=True))
        assert r["score"] == 0
        assert r["band"] == "MINIMAL"
        assert r["retracted"] is True

    def test_a_failing_rule_contributes_zero_not_a_guess(self, monkeypatch):
        import app.science.interest as I

        def boom(_e):
            raise RuntimeError("simulated")

        monkeypatch.setattr(I, "RULES", (boom,) + I.RULES)
        r = score_interest(ev("GW", far=1e-10))
        assert any(c["points"] == 0 and "Rule failed" in c["reason"]
                   for c in r["contributions"])
        assert any(c["rule"] == "significance" for c in r["contributions"])


class TestInterestScoring:

    def test_score_is_capped(self):
        r = score_interest(ev("GW", far=1e-12, HasNS=0.99, luminosityDistance=50.0,
                              area90Deg2=5.0, chirpMass=1.2))
        assert r["score"] == MAX_SCORE
        assert r["band"] == "HIGH"

    def test_every_point_is_traceable(self):
        r = score_interest(ev("GW", far=1e-10, HasNS=0.9))
        assert sum(c["points"] for c in r["contributions"]) >= r["score"]
        assert all(c["reason"] for c in r["contributions"])

    def test_nearby_bns_outranks_a_routine_grb(self):
        """The divergence this score exists to express."""
        bns = score_interest(ev("GW", far=1e-10, HasNS=0.95,
                                luminosityDistance=150.0, area90Deg2=18.0))
        grb = score_interest(ev("GRB", far=1e-7, errorRadius=2.0, t90=30.0))
        assert bns["score"] > grb["score"]

    def test_interest_and_quality_rank_events_differently(self):
        """
        The reason two scores exist. A flawlessly-measured routine GRB ranks
        top on data quality and bottom on interest; a nearby BNS merger with a
        15000 deg2 skymap ranks the other way round. One number could not
        express both, and conflating them would bury the merger.

        Note the quality score is NOT low for the merger: every value it
        reports is valid. A large credible region is poor *localization*, not
        untrustworthy *data* — which is itself the distinction being tested.
        """
        from app.science import score_quality, validate_event

        grb = ev("GRB", ra=100.0, dec=20.0, errorRadius=2.0,
                 errorRadiusContainment="90_2D", snr=20.0, far=1e-7,
                 t90=30.0, fluence=1e-6, fluenceBand="15-150 keV")
        bns = ev("GW", ra=100.0, dec=20.0, far=1e-10, HasNS=0.95,
                 luminosityDistance=150.0, area90Deg2=15000.0)

        q_grb = score_quality(grb, validate_event(grb))["overall"]
        q_bns = score_quality(bns, validate_event(bns))["overall"]
        i_grb = score_interest(grb)["score"]
        i_bns = score_interest(bns)["score"]

        assert q_grb > q_bns      # the GRB's data is better
        assert i_bns > i_grb      # the merger is far more worth studying

    def test_marginal_far_scores_zero_but_is_still_reported(self):
        r = score_interest(ev("GW", far=1e-4))
        sig = next(c for c in r["contributions"] if c["rule"] == "significance")
        assert sig["points"] == 0
        assert "marginal" in sig["reason"]

    def test_short_grb_never_asserts_a_progenitor(self):
        r = score_interest(ev("GRB", t90=0.5))
        text = " ".join(c["reason"] for c in r["contributions"]).lower()
        assert "not a determination of progenitor" in text

    def test_the_disclaimer_is_always_attached(self):
        for e in (ev("GRB"), ev("GW", isRetraction=True)):
            assert score_interest(e)["disclaimer"] == DISCLAIMER
        assert "not a measured property" in DISCLAIMER

    def test_an_unassessable_messenger_is_not_called_uninteresting(self):
        """
        Regression: five OTHER-type optical transients scored 0 and ranked as
        MINIMAL — indistinguishable from a genuinely dull event, when in truth
        no rule had ever looked at them.
        """
        r = score_interest(ev("QUASAR"))
        assert r["score"] == 0
        assert r["band"] == "UNASSESSED"
        assert r["band"] != "MINIMAL"
        assert "eventType" in r["unassessed"]
        assert "has not been judged at all" in r["note"]

    def test_a_recognised_messenger_with_nothing_measured_is_still_assessed(self):
        """The messenger baseline is itself an assessment, so this is LOW."""
        r = score_interest(ev("GRB"))
        assert r["band"] == "LOW"


# ===========================================================================
# AI context (spec sections 40-43)
# ===========================================================================

class TestAiContext:

    def test_absent_measurements_never_become_numbers(self):
        """The exact regression: `?? 0` presented UNKNOWN as a measurement."""
        ctx = build_context(ev("GRB"))
        assert ctx["measured"] == {}
        fields = {u["field"] for u in ctx["unknown"]}
        for f in ("ra", "dec", "far", "snr", "errorRadius"):
            assert f in fields

    def test_no_zero_appears_for_an_unmeasured_event(self):
        import json
        ctx = build_context(ev("GRB"))
        numbers = [v for v in json.dumps(ctx).split() if v.strip(",:").replace(".", "").isdigit()]
        assert all(float(n.strip(",:")) != 0.0 for n in numbers if n.strip(",:"))

    def test_measured_values_carry_unit_and_provenance(self):
        ctx = build_context(ev("GRB", snr=14.7))
        m = ctx["measured"]["snr"]
        assert m["value"] == 14.7
        assert m["provenance"] == "OBSERVED"
        assert "label" in m

    def test_unknowns_carry_a_reason(self):
        ctx = build_context(ev("GRB", snr=14.7))
        assert all(u["reason"] for u in ctx["unknown"])

    def test_derived_values_are_kept_separate_from_measured(self):
        """A modelled distance must never be presented as an observation."""
        ctx = build_context(ev("GRB", derived={
            "cosmological": {
                "luminosityDistance": {"value": 6800.0, "unit": "Mpc",
                                       "provenance": "DERIVED",
                                       "method": "D_L(z)", "assumptions": ["Planck18"]},
            }}))
        assert "luminosityDistance" not in ctx["measured"]
        d = ctx["derived"]["cosmological.luminosityDistance"]
        assert d["provenance"] == "DERIVED"
        assert d["assumptions"] == ["Planck18"]

    def test_underivable_quantities_are_not_included(self):
        ctx = build_context(ev("GRB", derived={
            "restFrame": {"t90Rest": {"value": None, "provenance": "UNKNOWN"}}}))
        assert ctx["derived"] == {}

    def test_the_rules_travel_with_the_context(self):
        ctx = build_context(ev("GRB"))
        assert ctx["instructions"] == CONTEXT_RULES
        joined = " ".join(CONTEXT_RULES).lower()
        assert "do not describe it as zero" in joined
        assert "never present it as an observation" in joined

    def test_quality_score_is_labelled_as_data_quality(self):
        ctx = build_context(ev("GRB", quality={"overall": 46}))
        assert ctx["dataQuality"]["qualityScore"] == 46
        assert "not how" in ctx["dataQuality"]["note"]


# ===========================================================================
# AI output verification
# ===========================================================================

class TestOutputVerification:

    def setup_method(self):
        self.ctx = build_context(ev("GRB", snr=14.7, fluence=8.4e-7))

    def test_a_supplied_value_passes(self):
        v = verify_output("The event was detected with SNR 14.7.", self.ctx)
        assert v["trusted"] is True
        assert v["unsupportedCount"] == 0

    def test_a_fabricated_measurement_is_caught(self):
        v = verify_output(
            "The burst had a redshift of 2.35 and lasted 47.2 seconds.", self.ctx)
        assert v["trusted"] is False
        flagged = {u["text"] for u in v["unsupported"]}
        assert "2.35" in flagged and "47.2" in flagged

    def test_rounding_of_a_supplied_value_is_accepted(self):
        v = verify_output("SNR was approximately 14.6.", self.ctx)
        assert v["trusted"] is True

    def test_scientific_notation_is_matched(self):
        v = verify_output("The fluence was 8.4e-07 erg/cm2.", self.ctx)
        assert v["trusted"] is True

    def test_small_integers_in_prose_are_ignored(self):
        """'within 3 days', '2 candidates' must not bury real findings."""
        v = verify_output(
            "Follow up within 3 days using 2 wide-field instruments.", self.ctx)
        assert v["trusted"] is True

    def test_years_are_ignored(self):
        v = verify_output("Comparable to the 2017 multi-messenger event.", self.ctx)
        assert v["trusted"] is True

    def test_the_screen_reports_its_own_limits(self):
        v = verify_output("SNR 14.7.", self.ctx)
        assert "cannot verify that the interpretation" in v["note"]

    def test_non_string_output_is_handled(self):
        v = verify_output({"significance": "SNR was 14.7"}, self.ctx)
        assert v["checked"] is True

    def test_a_fabricated_position_is_caught(self):
        """
        The concrete failure the old context would have produced: a model
        describing an unlocalized event as sitting somewhere specific.
        """
        ctx = build_context(ev("GRB"))
        v = verify_output("Located at RA 197.45, Dec -23.38.", ctx)
        assert v["trusted"] is False
        assert v["unsupportedCount"] == 2

    def test_duplicate_mentions_are_reported_once(self):
        v = verify_output("z = 2.35, i.e. a redshift of 2.35.", self.ctx)
        assert v["unsupportedCount"] == 1
