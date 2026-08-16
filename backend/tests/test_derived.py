"""
test_derived.py
---------------
Phase 5 tests: units, uncertainty, localization semantics, cosmology,
observability and derived quantities (spec sections 19-24, 33-34).

As in Phase 4, the refusals matter as much as the calculations. The assertions
that carry the most weight here are the ones proving the pipeline will NOT:

  * guess a unit, or convert across dimensions;
  * invent an uncertainty for an input that has none;
  * assume a containment convention the source never stated;
  * compute an altitude without a real observatory;
  * present a band-limited E_iso as if it were the bolometric one.

Numerical expectations are taken from independent physics, not from this
implementation's own output.
"""

import math
import os

import pytest

from app.science import cosmology, derivations, observability, units
from app.science import validate_event
from app.science.uncertainty import (
    Measurement,
    area_to_radius_deg,
    containment_scale,
    convert_containment,
    radius_to_area_deg2,
)

T = "2026-08-10T10:00:00Z"


def ev(etype="GRB", **over):
    e = {"eventId": "T1", "eventType": etype, "observatory": "Obs",
         "detectionTime": T, "ra": 83.63, "dec": 22.01}
    e.update(over)
    return e


def codes(e):
    return set(validate_event(e).codes())


# ===========================================================================
# Units (spec section 34)
# ===========================================================================

class TestUnits:

    @pytest.mark.parametrize("value,unit,expected", [
        (1.0, "deg", 1.0),
        (60.0, "arcmin", 1.0),
        (3600.0, "arcsec", 1.0),
        (1.0, "rad", 180.0 / math.pi),
        (2.0, "TeV", 2000.0),
        (1.0, "PeV", 1e6),
        (1.0, "keV", 1e-6),
        (1000.0, "kpc", 1.0),          # 1000 kpc = 1 Mpc
        (1.0, "Gpc", 1000.0),
    ])
    def test_canonical_conversions(self, value, unit, expected):
        assert units.to_canonical(value, unit) == pytest.approx(expected, rel=1e-9)

    def test_erg_to_gev_is_the_published_constant(self):
        # 1 erg = 1e-7 J, and 1 J = 6.241509074e18 eV -> 624.15 GeV.
        assert units.to_canonical(1.0, "erg") == pytest.approx(624.15, rel=1e-4)

    def test_steradian_to_square_degrees(self):
        # A full sphere is 4*pi sr = 41252.96 deg^2.
        assert units.to_canonical(4 * math.pi, "sr") == pytest.approx(41252.96, rel=1e-6)

    def test_an_absent_unit_is_never_assumed(self):
        assert units.to_canonical(100.0, None) is None
        assert units.to_canonical(100.0, "") is None

    def test_an_unknown_unit_is_refused(self):
        assert units.resolve("furlongs") is None
        assert units.to_canonical(1.0, "furlongs") is None

    def test_cross_dimension_conversion_is_refused(self):
        """An energy is not an angle; converting between them hides a real bug."""
        assert units.convert(1.0, "erg", "deg") is None
        assert units.same_dimension("erg", "deg") is False

    def test_same_dimension_is_none_when_unresolvable(self):
        assert units.same_dimension("erg", "furlongs") is None

    def test_quantity_preserves_the_original(self):
        q = units.Quantity(value=120.0, unit="TeV", provenance="OBSERVED")
        assert q.value == 120.0 and q.unit == "TeV"     # untouched
        assert q.canonical == pytest.approx(1.2e5)
        assert q.canonical_unit == "GeV"
        assert q.interpretable

    def test_quantity_without_a_resolvable_unit_is_not_interpretable(self):
        q = units.Quantity(value=120.0, unit=None)
        assert q.known                 # we have a number
        assert not q.interpretable     # but it means nothing
        assert q.canonical is None

    def test_unknown_carries_its_reason(self):
        q = units.unknown("No redshift reported.")
        assert q.value is None
        assert q.provenance == "UNKNOWN"
        assert "redshift" in (q.note or "")

    def test_ambiguous_case_folding_is_refused(self, monkeypatch):
        """
        Case is significant in physics. The registry has no colliding pair
        today, so the guard is exercised by introducing one — it must protect
        future additions rather than silently resolve them.
        """
        monkeypatch.setitem(units.UNITS, "Xy", ("ANGLE", 1.0))
        monkeypatch.setitem(units.UNITS, "XY", ("ENERGY", 1.0))
        monkeypatch.setattr(units, "AMBIGUOUS_FOLDS", units.AMBIGUOUS_FOLDS | {"xy"})
        assert units.resolve("xY") is None          # ambiguous -> refused
        assert units.resolve("Xy") is not None      # exact match still wins


class TestUnitValidation:

    def test_unrecognised_unit_is_an_error(self):
        assert "unit_unrecognised" in codes(ev(energy=100.0, energyUnit="furlongs"))

    def test_wrong_dimension_is_an_error(self):
        """A fluence labelled in degrees means two quantities were crossed."""
        c = codes(ev(fluence=1e-6, fluenceUnit="deg"))
        assert "unit_wrong_dimension" in c

    def test_correct_unit_produces_no_finding(self):
        c = codes(ev(fluence=1e-6, fluenceUnit="erg/cm2"))
        assert "unit_unrecognised" not in c
        assert "unit_wrong_dimension" not in c

    def test_a_unit_describing_nothing_is_noticed(self):
        assert "unit_without_value" in codes(ev(energyUnit="TeV"))


# ===========================================================================
# Uncertainty propagation (spec section 24)
# ===========================================================================

class TestPropagation:

    def test_sum_adds_in_quadrature(self):
        a, b = Measurement(10.0, 3.0), Measurement(20.0, 4.0)
        r = a.plus(b)
        assert r.value == 30.0
        assert r.sigma == pytest.approx(5.0)        # sqrt(9 + 16)

    def test_difference_also_adds_in_quadrature(self):
        """Errors grow on subtraction too — they do not cancel."""
        r = Measurement(500.0, 30.0).minus(Measurement(100.0, 40.0))
        assert r.value == 400.0
        assert r.sigma == pytest.approx(50.0)

    def test_product_relative_errors_combine(self):
        r = Measurement(4.0, 0.4).times(Measurement(5.0, 1.0))   # 10% and 20%
        assert r.value == pytest.approx(20.0)
        assert r.sigma / r.value == pytest.approx(math.hypot(0.1, 0.2))

    def test_ratio_relative_errors_combine(self):
        r = Measurement(4.0, 0.4).over(Measurement(5.0, 1.0))
        assert r.value == pytest.approx(0.8)
        assert r.sigma / r.value == pytest.approx(math.hypot(0.1, 0.2))

    def test_power_scales_the_relative_error(self):
        r = Measurement(10.0, 1.0).powed(2)          # 10% -> 20%
        assert r.value == pytest.approx(100.0)
        assert r.sigma / r.value == pytest.approx(0.2)

    def test_an_unknown_input_uncertainty_stays_unknown(self):
        """The cardinal rule: never invent an error bar, never degrade to zero."""
        r = Measurement(10.0, 2.0).times(Measurement(3.0, None))
        assert r.value == pytest.approx(30.0)
        assert r.sigma is None
        assert r.to_dict()["uncertaintyKnown"] is False

    def test_exact_constants_carry_no_error(self):
        r = Measurement(10.0, 1.0).scaled(3.0)
        assert (r.value, r.sigma) == (30.0, 3.0)

    def test_negative_sigma_is_rejected_not_used(self):
        m = Measurement.of(5.0, -1.0)
        assert m.sigma is None

    def test_independence_assumption_is_recorded(self):
        r = Measurement(4.0, 0.4).times(Measurement(5.0, 1.0))
        assert r.assumed_independent is True
        assert r.to_dict()["assumedIndependent"] is True

    def test_correlation_can_be_supplied(self):
        """Perfectly anti-correlated inputs cancel; the model allows saying so."""
        a, b = Measurement(10.0, 3.0), Measurement(4.0, 3.0)
        r = a.minus(b, cov=9.0)                      # cov = sigma_a * sigma_b
        assert r.sigma == pytest.approx(0.0)
        assert r.assumed_independent is False

    def test_division_by_zero_returns_none(self):
        assert Measurement(1.0, 0.1).over(Measurement(0.0, 0.1)) is None

    def test_render_states_when_uncertainty_is_unknown(self):
        assert "uncertainty unknown" in Measurement(5.0).render()
        assert "+/-" in Measurement(5.0, 0.5).render()


# ===========================================================================
# Localization semantics (spec section 23)
# ===========================================================================

class TestContainment:

    def test_two_dimensional_containment_scales(self):
        """Rayleigh: R = sigma*sqrt(-2 ln(1-P)). Textbook values."""
        assert containment_scale(0.90, 2) == pytest.approx(2.1460, abs=1e-4)
        assert containment_scale(0.50, 2) == pytest.approx(1.1774, abs=1e-4)
        assert containment_scale(0.6827, 2) == pytest.approx(1.5152, abs=1e-3)

    def test_one_dimensional_containment_scales(self):
        assert containment_scale(0.90, 1) == pytest.approx(1.6449, abs=1e-4)
        assert containment_scale(0.6827, 1) == pytest.approx(1.0, abs=1e-3)

    def test_one_and_two_dimensional_containment_differ(self):
        """
        The trap this module exists for: '68% containment' of a sky
        localization is 1.515 sigma, not 1 sigma. Treating them as equal
        understates the region by ~50%.
        """
        assert containment_scale(0.6827, 2) > 1.5 * containment_scale(0.6827, 1)

    def test_containment_conversion_round_trips(self):
        r90 = 10.0
        r50 = convert_containment(r90, 0.90, 0.50, dim=2)
        assert convert_containment(r50, 0.50, 0.90, dim=2) == pytest.approx(r90)

    def test_ninety_percent_is_about_twice_one_sigma(self):
        # 2.146 / 1.0 for a 2-D Gaussian at its 1-sigma radius.
        assert convert_containment(1.0, 0.3935, 0.90, dim=2) == pytest.approx(2.146, abs=1e-3)

    def test_invalid_fraction_is_refused(self):
        assert containment_scale(0.0) is None
        assert containment_scale(1.0) is None
        assert containment_scale(1.5) is None


class TestSkyAreas:

    def test_small_area_matches_the_flat_approximation(self):
        r = area_to_radius_deg(100.0)
        assert r == pytest.approx(math.sqrt(100.0 / math.pi), rel=1e-3)

    def test_large_area_must_not_use_the_flat_formula(self):
        """
        At 20000 deg^2 the flat-sky formula understates the radius by ~10%,
        and poorly-localized GW events routinely reach that size.
        """
        r = area_to_radius_deg(20000.0)
        flat = math.sqrt(20000.0 / math.pi)
        assert r > flat * 1.05
        assert r == pytest.approx(88.26, abs=0.1)

    def test_radius_and_area_round_trip(self):
        assert area_to_radius_deg(radius_to_area_deg2(17.5)) == pytest.approx(17.5)

    def test_whole_sky(self):
        # Uses the exact constant, not a rounded literal: arccos is extremely
        # flat near the pole, so a 0.001 deg^2 rounding in the area moves the
        # radius by 0.02 deg.
        from app.science.uncertainty import FULL_SKY_DEG2
        assert area_to_radius_deg(FULL_SKY_DEG2) == pytest.approx(180.0, abs=1e-6)

    def test_area_beyond_the_sky_is_refused(self):
        assert area_to_radius_deg(50000.0) is None
        assert area_to_radius_deg(0.0) is None


class TestLocalizationValidation:

    def test_unstated_containment_is_noticed_not_warned(self):
        """
        Nearly every alert omits it, so this must not be a WARNING — a finding
        on every event would train researchers to ignore the panel.
        """
        rep = validate_event(ev(errorRadius=5.0))
        assert rep.has("containment_convention_unstated")
        assert rep.status in ("PASS", "WARNING")     # not FAIL
        d = next(x for x in rep.diagnostics
                 if x.code == "containment_convention_unstated")
        assert d.level.label == "NOTICE"

    def test_stated_containment_produces_no_finding(self):
        assert "containment_convention_unstated" not in codes(
            ev(errorRadius=5.0, errorRadiusContainment="90_2D"))

    def test_unrecognised_containment_is_an_error(self):
        assert "containment_convention_unrecognised" in codes(
            ev(errorRadius=5.0, errorRadiusContainment="ROUGHLY"))

    def test_area_exceeding_the_sky_is_an_error(self):
        assert "credible_area_exceeds_sky" in codes(ev(area90Deg2=99999.0))

    def test_radius_and_area_that_disagree_are_flagged(self):
        """
        The exact shape of the normalizer bug: a 100 deg^2 credible area
        recorded as a 100 arcmin (1.67 deg) radius, when the equivalent radius
        is 5.6 deg.
        """
        assert "radius_area_discrepant" in codes(
            ev(errorRadius=100.0, area90Deg2=100.0))

    def test_consistent_radius_and_area_are_not_flagged(self):
        r_deg = area_to_radius_deg(100.0)
        assert "radius_area_discrepant" not in codes(
            ev(errorRadius=r_deg * 60.0, area90Deg2=100.0))


# ===========================================================================
# Cosmology (spec section 33)
# ===========================================================================

class TestCosmology:

    def test_default_model_is_named_and_stamped(self):
        st = cosmology.stamp()
        assert st.name == "Planck18"
        assert st.available
        assert st.H0 == 67.66
        assert "Planck" in st.reference

    def test_luminosity_distance_matches_the_literature(self):
        """D_L(z=1) is ~6800 Mpc under Planck18."""
        d = cosmology.luminosity_distance_mpc(1.0)
        assert d.value == pytest.approx(6800.0, rel=0.01)

    def test_lookback_time_matches_the_literature(self):
        assert cosmology.lookback_time_gyr(1.0) == pytest.approx(7.94, rel=0.01)

    def test_low_redshift_approaches_hubbles_law(self):
        """At small z, D_L ~ cz/H0. A model that fails this is misconfigured."""
        z = 0.01
        d = cosmology.luminosity_distance_mpc(z).value
        hubble = 299792.458 * z / 67.66
        assert d == pytest.approx(hubble, rel=0.02)

    def test_redshift_uncertainty_propagates_into_distance(self):
        d = cosmology.luminosity_distance_mpc(1.0, 0.05)
        assert d.sigma is not None and d.sigma > 0
        bare = cosmology.luminosity_distance_mpc(1.0)
        assert bare.sigma is None          # no input error -> no output error

    def test_distance_inversion_round_trips(self):
        d = cosmology.luminosity_distance_mpc(0.5).value
        assert cosmology.redshift_from_luminosity_distance(d) == pytest.approx(0.5, rel=1e-3)

    def test_negative_and_absent_redshift_derive_nothing(self):
        assert cosmology.luminosity_distance_mpc(-0.5) is None
        assert cosmology.luminosity_distance_mpc(None) is None

    def test_an_unknown_configured_model_derives_nothing(self, monkeypatch):
        """A typo in configuration must fail loudly, never fall back to a default."""
        monkeypatch.setenv(cosmology.ENV_VAR, "PlankEighteen")
        cosmology.reset_cache()
        try:
            st = cosmology.stamp()
            assert st.available is False
            assert "not a recognised cosmology" in (st.reason or "")
            assert cosmology.luminosity_distance_mpc(1.0) is None
        finally:
            monkeypatch.delenv(cosmology.ENV_VAR, raising=False)
            cosmology.reset_cache()

    def test_configured_model_is_actually_used(self, monkeypatch):
        """Switching the model must change the numbers, or the stamp is a lie."""
        planck = cosmology.luminosity_distance_mpc(1.0).value
        monkeypatch.setenv(cosmology.ENV_VAR, "WMAP9")
        cosmology.reset_cache()
        try:
            assert cosmology.stamp().name == "WMAP9"
            wmap = cosmology.luminosity_distance_mpc(1.0).value
            assert wmap != pytest.approx(planck, rel=1e-4)
        finally:
            monkeypatch.delenv(cosmology.ENV_VAR, raising=False)
            cosmology.reset_cache()


class TestEiso:

    def test_band_limited_eiso_matches_a_hand_calculation(self):
        """
        E = 4*pi*D_L^2*S/(1+z) with D_L(z=1) = 6797 Mpc, S = 5e-7 erg/cm2:
        D_L = 2.0975e28 cm -> E = 1.38e51 erg.
        """
        e, caveat = cosmology.eiso_band_limited(5e-7, 1.0)
        assert e.value == pytest.approx(1.38e51, rel=0.02)
        assert "NOT the bolometric" in caveat

    def test_eiso_is_in_the_astrophysical_range(self):
        e, _ = cosmology.eiso_band_limited(1e-5, 2.0)
        assert 1e50 < e.value < 1e56

    def test_eiso_requires_a_redshift(self):
        e, reason = cosmology.eiso_band_limited(5e-7, None)
        assert e is None and "redshift" in reason.lower()

    def test_eiso_uncertainty_propagates(self):
        e, _ = cosmology.eiso_band_limited(5e-7, 1.0, 5e-8, 0.05)
        assert e.sigma is not None and e.sigma > 0

    def test_grb_reports_band_limited_eiso_only_with_a_band(self):
        with_band = codes(ev("GRB", t90=10.0, fluence=5e-7,
                             fluenceBand="15-150 keV", redshift=1.0))
        assert "grb_eiso_band_limited" in with_band
        assert "grb_eiso_not_bolometric" in with_band

    def test_grb_refuses_eiso_without_a_band(self):
        c = codes(ev("GRB", t90=10.0, fluence=5e-7, redshift=1.0))
        assert "grb_eiso_not_derived" in c
        assert "grb_eiso_band_limited" not in c


# ===========================================================================
# Observability (spec sections 21-22)
# ===========================================================================

class TestObservability:

    def test_no_site_means_no_numbers(self, monkeypatch):
        for k in (observability.ENV_LAT, observability.ENV_LON):
            monkeypatch.delenv(k, raising=False)
        obs = observability.compute(83.63, 22.01, T)
        assert obs.available is False
        assert obs.altitude_deg is None and obs.airmass is None
        assert "No observing site is configured" in (obs.reason or "")

    def test_half_a_site_is_not_completed_with_zeros(self, monkeypatch):
        """(0, 0) is a real place and would give plausible, wrong altitudes."""
        monkeypatch.setenv(observability.ENV_LAT, "19.0")
        monkeypatch.delenv(observability.ENV_LON, raising=False)
        cfg = observability.load_site()
        assert cfg.configured is False
        assert "half-configured" in (cfg.reason or "")

    def test_non_numeric_site_is_refused(self, monkeypatch):
        monkeypatch.setenv(observability.ENV_LAT, "north-ish")
        monkeypatch.setenv(observability.ENV_LON, "-70.0")
        assert observability.load_site().configured is False

    def test_out_of_range_latitude_is_refused(self, monkeypatch):
        monkeypatch.setenv(observability.ENV_LAT, "120.0")
        monkeypatch.setenv(observability.ENV_LON, "-70.0")
        assert observability.load_site().configured is False

    def test_a_configured_site_produces_real_geometry(self, monkeypatch):
        # Paranal: -24.6275, -70.4044, 2635 m.
        monkeypatch.setenv(observability.ENV_LAT, "-24.6275")
        monkeypatch.setenv(observability.ENV_LON, "-70.4044")
        monkeypatch.setenv(observability.ENV_ELEV, "2635")
        monkeypatch.setenv(observability.ENV_NAME, "Paranal")
        obs = observability.compute(83.63, 22.01, T)
        assert obs.available
        assert -90.0 <= obs.altitude_deg <= 90.0
        assert 0.0 <= obs.azimuth_deg < 360.0
        assert obs.site.name == "Paranal"

    def test_a_target_at_the_zenith_has_airmass_one(self, monkeypatch):
        """
        Sanity check against real geometry: a source whose declination equals
        the site latitude transits through the zenith, where airmass = 1.
        """
        monkeypatch.setenv(observability.ENV_LAT, "0.0")
        monkeypatch.setenv(observability.ENV_LON, "0.0")
        # Find the transit instant by scanning; independent of the module's
        # own claims about altitude.
        best = None
        for minute in range(0, 24 * 60, 5):
            t = f"2026-08-10T{minute // 60:02d}:{minute % 60:02d}:00Z"
            o = observability.compute(180.0, 0.0, t)
            if o.available and (best is None or o.altitude_deg > best.altitude_deg):
                best = o
        assert best.altitude_deg > 89.0
        assert best.airmass == pytest.approx(1.0, abs=0.01)

    def test_airmass_grows_towards_the_horizon(self):
        assert observability.airmass_kasten_young(90.0) == pytest.approx(1.0, abs=1e-3)
        assert observability.airmass_kasten_young(30.0) == pytest.approx(2.0, abs=0.02)
        assert observability.airmass_kasten_young(5.0) > 10.0

    def test_airmass_is_undefined_below_the_horizon(self):
        """Not 'very large' — a target that has set has no airmass at all."""
        assert observability.airmass_kasten_young(-5.0) is None
        assert observability.airmass_kasten_young(0.0) is None

    def test_no_position_means_no_observability(self, monkeypatch):
        monkeypatch.setenv(observability.ENV_LAT, "-24.6275")
        monkeypatch.setenv(observability.ENV_LON, "-70.4044")
        obs = observability.compute(None, None, T)
        assert obs.available is False
        assert "no sky position" in (obs.reason or "")

    def test_no_diagnostic_is_emitted_without_a_site(self, monkeypatch):
        for k in (observability.ENV_LAT, observability.ENV_LON):
            monkeypatch.delenv(k, raising=False)
        c = codes(ev())
        assert not any(x.startswith("target_") for x in c)


# ===========================================================================
# Derived block (spec sections 19-24)
# ===========================================================================

class TestDerivations:

    def test_every_block_is_present(self):
        d = derivations.derive_all(ev("GRB", t90=10.0))
        assert set(d) == {"restFrame", "cosmological", "localization", "observability"}

    def test_rest_frame_t90_is_time_dilated(self):
        d = derivations.rest_frame(ev(t90=30.0, redshift=2.0))
        assert d["t90Rest"]["value"] == pytest.approx(10.0)
        assert d["t90Rest"]["unit"] == "s"
        assert d["t90Rest"]["provenance"] == "DERIVED"

    def test_rest_frame_epeak_is_blueshifted(self):
        d = derivations.rest_frame(ev(epeak=300.0, redshift=1.0))
        assert d["epeakRest"]["value"] == pytest.approx(600.0)

    def test_rest_frame_propagates_both_input_errors(self):
        # T90 = 30 +/- 1, z = 2 +/- 0.1 -> (1+z) = 3 +/- 0.1, T90_rest = 10.
        # Relative: sqrt((1/30)^2 + (0.1/3)^2) = 0.04714 -> sigma = 0.4714.
        d = derivations.rest_frame(
            ev(t90=30.0, t90Error=1.0, redshift=2.0, redshiftError=0.1))
        assert d["t90Rest"]["value"] == pytest.approx(10.0)
        assert d["t90Rest"]["sigma"] == pytest.approx(0.4714, rel=1e-3)

    def test_a_missing_input_error_yields_no_output_error(self):
        """
        T90 has no reported uncertainty, so the total uncertainty on the
        rest-frame value is genuinely unknown even though z's error is known.
        Reporting only the redshift term would understate it while looking
        authoritative — so no error bar is given, and that is said explicitly.
        """
        d = derivations.rest_frame(ev(t90=30.0, redshift=2.0, redshiftError=0.1))
        q = d["t90Rest"]
        assert q["value"] == pytest.approx(10.0)
        assert q["sigma"] is None
        assert q["uncertaintyKnown"] is False

    def test_unknown_carries_a_reason_and_a_requirement(self):
        """UNKNOWN must be actionable, not blank."""
        d = derivations.rest_frame(ev(t90=30.0))
        q = d["t90Rest"]
        assert q["value"] is None
        assert q["provenance"] == "UNKNOWN"
        assert "redshift" in q["note"].lower()
        assert "redshift" in q["requires"]

    def test_no_typical_redshift_is_substituted(self):
        d = derivations.cosmological(ev(fluence=1e-6, fluenceBand="15-150 keV"))
        assert d["luminosityDistance"]["value"] is None
        assert d["eIsoBand"]["value"] is None

    def test_cosmology_stamp_travels_with_the_numbers(self):
        d = derivations.cosmological(ev(redshift=1.0))
        assert d["cosmology"]["name"] == "Planck18"
        assert any("Planck18" in a for a in d["luminosityDistance"]["assumptions"])

    def test_eiso_carries_the_non_bolometric_caveat(self):
        d = derivations.cosmological(
            ev(redshift=1.0, fluence=5e-7, fluenceBand="15-150 keV"))
        assert d["eIsoBand"]["value"] == pytest.approx(1.38e51, rel=0.02)
        assert any("NOT the bolometric" in a for a in d["eIsoBand"]["assumptions"])

    def test_localization_states_when_the_convention_is_missing(self):
        d = derivations.localization(ev(errorRadius=5.0))
        rep = d["reported"]
        assert rep["containmentStated"] is False
        assert "not stated" in rep["note"]

    def test_localization_equivalent_radius_is_labelled_not_a_search_radius(self):
        d = derivations.localization(ev(area90Deg2=1000.0))
        q = d["area90Deg2"]
        assert q["value"] == pytest.approx(17.91, abs=0.05)
        assert any("not be used as a search radius" in a for a in q["assumptions"])

    def test_derivation_never_mutates_the_event(self):
        e = ev("GRB", t90=10.0, redshift=1.0)
        before = dict(e)
        derivations.derive_all(e)
        assert e == before

    def test_a_failing_derivation_does_not_break_the_others(self, monkeypatch):
        def boom(_e):
            raise RuntimeError("simulated")
        monkeypatch.setattr(derivations, "rest_frame", boom)
        d = derivations.derive_all(ev())
        assert "error" in d["restFrame"]
        assert "localization" in d          # the rest still ran
