"""
grb.py
------
Gamma-ray burst validation (spec sections 9-13).

The single most important rule here is restraint. A T90 below 2 seconds is
*statistically* associated with compact-binary mergers, but it is not proof of
one: the short/long split is detector-dependent, the distributions overlap
heavily, and well-known counterexamples exist in both directions
(e.g. GRB 211211A — a long burst with a kilonova). So this module classifies
duration and says so explicitly, and never asserts a progenitor.

On isotropic energy the module draws a line rather than an all-or-nothing
refusal. With a redshift, an explicit cosmology (Phase 5) and a *stated* energy
band, the band-limited isotropic energy 4*pi*D_L^2*S/(1+z) is fully defined and
is derived, stamped with the cosmology it assumed. The bolometric E_iso quoted
in catalogues is still NOT derived: it needs a k-correction from a fitted
spectral model that no alert payload carries. The two differ by a factor of
roughly 1.5-5 that is not a constant, so they are never conflated.
"""

from __future__ import annotations

from typing import Any

from app.science import cosmology
from app.science.diagnostics import ValidationReport
from app.science.uncertainty import Measurement

#: Conventional T90 split (Kouveliotou et al. 1993, BATSE 50-300 keV).
#: Instrument-dependent — recorded alongside any classification.
T90_SHORT_MAX_S = 2.0

#: T90 longer than this is extremely unusual and worth a human look.
T90_IMPLAUSIBLE_S = 10_000.0

#: Fluence outside this range (erg/cm2) is almost certainly a unit error.
FLUENCE_MIN, FLUENCE_MAX = 1e-12, 1e-1

#: Observed Epeak range (keV). Outside this suggests a unit mix-up (MeV/keV).
EPEAK_MIN_KEV, EPEAK_MAX_KEV = 1.0, 1e5


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def classify_duration(t90: float) -> dict[str, Any]:
    """
    Duration classification with its caveats attached.

    Returns the class *and* the reason it must not be read as a progenitor
    determination, so no consumer can quote the label without the caveat.
    """
    is_short = t90 < T90_SHORT_MAX_S
    return {
        "class": "short" if is_short else "long",
        "threshold_s": T90_SHORT_MAX_S,
        "convention": "Kouveliotou et al. 1993 (BATSE 50-300 keV)",
        "caveat": (
            "Duration classes are statistical and detector-dependent; the "
            "short and long populations overlap substantially. This is NOT a "
            "determination of progenitor type."
        ),
        "provenance": "DERIVED",
    }


def validate(ev: dict[str, Any], rep: ValidationReport) -> None:
    t90 = _num(ev.get("t90"))
    fluence = _num(ev.get("fluence"))
    band = ev.get("fluenceBand")
    epeak = _num(ev.get("epeak"))
    z = _num(ev.get("redshift"))

    # ── Duration ────────────────────────────────────────────────────────────
    if t90 is None:
        rep.warning("grb_t90_missing",
                    "No T90 reported; burst duration and its classification are unavailable.",
                    "t90")
    else:
        if t90 <= 0:
            rep.error("grb_t90_non_positive",
                      f"T90 {t90} s is not positive; a burst duration must exceed zero.",
                      "t90", t90)
        elif t90 > T90_IMPLAUSIBLE_S:
            rep.warning("grb_t90_implausible",
                        f"T90 {t90} s is far longer than any catalogued GRB; "
                        "check the unit (seconds vs milliseconds).", "t90", t90)
        else:
            cls = classify_duration(t90)
            rep.info("grb_duration_class",
                     f"T90 {t90:.2f} s classifies as a {cls['class']} burst under the "
                     f"{cls['convention']} convention. {cls['caveat']}",
                     "t90", cls["class"])

    # ── Fluence ─────────────────────────────────────────────────────────────
    if fluence is not None:
        if fluence <= 0:
            rep.error("grb_fluence_non_positive",
                      f"Fluence {fluence} erg/cm2 is not positive.", "fluence", fluence)
        elif not (FLUENCE_MIN <= fluence <= FLUENCE_MAX):
            rep.warning("grb_fluence_implausible",
                        f"Fluence {fluence:.3e} erg/cm2 is outside the range seen in "
                        f"GRB catalogues ({FLUENCE_MIN:.0e}-{FLUENCE_MAX:.0e}); "
                        "check units.", "fluence", fluence)
        if not band:
            rep.notice("grb_fluence_band_missing",
                       "Fluence is reported without an energy band. Fluences from "
                       "different instruments are not comparable without the band, "
                       "the detector response and the integration interval.",
                       "fluence")

    # ── Spectral peak energy ────────────────────────────────────────────────
    if epeak is not None:
        if epeak <= 0:
            rep.error("grb_epeak_non_positive",
                      f"Epeak {epeak} keV is not positive.", "epeak", epeak)
        elif not (EPEAK_MIN_KEV <= epeak <= EPEAK_MAX_KEV):
            rep.warning("grb_epeak_implausible",
                        f"Epeak {epeak} keV is outside the plausible observed range; "
                        "check for a keV/MeV unit mix-up.", "epeak", epeak)

    # ── Rest-frame quantities (spec section 13) ─────────────────────────────
    # Only derivable with a redshift. Without one these stay UNKNOWN; an
    # invented redshift would silently propagate into every rest-frame number.
    if z is None:
        if t90 is not None or epeak is not None:
            rep.info("grb_rest_frame_unavailable",
                     "No redshift reported, so rest-frame quantities (rest-frame "
                     "T90, rest-frame Epeak, E_iso) cannot be derived. They are "
                     "UNKNOWN rather than estimated.", "redshift")
    else:
        if z < 0:
            rep.error("grb_redshift_negative",
                      f"Redshift {z} is negative.", "redshift", z)
        elif z > 20:
            rep.warning("grb_redshift_implausible",
                        f"Redshift {z} exceeds any confirmed GRB; verify the source.",
                        "redshift", z)
        else:
            z_sig = _num(ev.get("redshiftError"))
            one_plus_z = Measurement(1.0 + z, z_sig)

            if t90 is not None and t90 > 0:
                m = Measurement.of(t90, ev.get("t90Error"))
                r = m.over(one_plus_z) if m else None
                if r is not None:
                    rep.info("grb_rest_frame_t90",
                             f"Rest-frame T90 = {r.render(3, 's')} "
                             f"(T90_obs / (1+z), z = {z}).", "t90", r.value)
            if epeak is not None and epeak > 0:
                m = Measurement.of(epeak, ev.get("epeakError"))
                r = m.times(one_plus_z) if m else None
                if r is not None:
                    rep.info("grb_rest_frame_epeak",
                             f"Rest-frame Epeak = {r.render(4, 'keV')} "
                             f"(Epeak_obs x (1+z), z = {z}).", "epeak", r.value)

        # ── Isotropic energy (spec sections 13, 33) ─────────────────────────
        # With an explicit cosmology the *band-limited* isotropic energy is
        # computable, and only that. The bolometric E_iso of the literature
        # additionally needs a k-correction from a fitted spectral model, which
        # no alert payload carries — so it stays UNKNOWN, and the band-limited
        # value is never labelled "E_iso" without its qualifier.
        if fluence is not None and fluence > 0:
            if not band:
                rep.info("grb_eiso_not_derived",
                         "Isotropic energy is not derived: the fluence has no "
                         "stated energy band, so the result would not be "
                         "comparable to any published value.", "fluence")
            else:
                e, caveat = cosmology.eiso_band_limited(
                    fluence, z, _num(ev.get("fluenceError")),
                    _num(ev.get("redshiftError")))
                st = cosmology.stamp()
                if e is None:
                    rep.info("grb_eiso_not_derived",
                             f"Isotropic energy is not derived: {caveat}", "fluence")
                else:
                    rep.info(
                        "grb_eiso_band_limited",
                        f"Band-limited isotropic energy = {e.render(3, 'erg')} "
                        f"over {band}, assuming {st.name} "
                        f"(H0 = {st.H0} km/s/Mpc, Om0 = {st.Om0}). {caveat}",
                        "fluence", e.value,
                    )
                    rep.info(
                        "grb_eiso_not_bolometric",
                        "The bolometric E_iso quoted in GRB catalogues is NOT "
                        "derived: it requires a k-correction to a fixed "
                        "rest-frame band (typically 1-10000 keV) from a fitted "
                        "spectral model, which this payload does not carry.",
                        "fluence",
                    )
