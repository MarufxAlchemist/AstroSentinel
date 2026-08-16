"""
gw.py
-----
Gravitational-wave validation (spec sections 14-16).

Two traps this module exists to avoid:

  * Classification probabilities are only required to sum to 1 when they form
    an exhaustive partition. LVK's {BNS, NSBH, BBH, Terrestrial} does; HasNS
    and HasRemnant are *separate marginal* probabilities over the same event
    and must NOT be added into that sum. The spec is explicit that we must not
    blindly normalise.

  * A redshift obtained by inverting a luminosity distance is model-dependent
    (it assumes a cosmology). It must never be presented like a spectroscopic
    redshift. This module does not compute one at all; it only records that
    the distinction exists if a redshift is supplied alongside a distance.
"""

from __future__ import annotations

from typing import Any

from app.science import cosmology
from app.science.diagnostics import ValidationReport
from app.science.uncertainty import INDEPENDENCE_CAVEAT, Measurement, area_to_radius_deg

#: The exhaustive LVK classification partition.
PARTITION_KEYS = ("BNS", "NSBH", "BBH", "Terrestrial")

#: Marginal probabilities over the same event — NOT part of the partition.
MARGINAL_KEYS = ("HasNS", "HasRemnant", "HasMassGap")

#: Tolerance on the partition sum, allowing for rounding in the notice.
PARTITION_TOLERANCE = 0.02

#: Neutron stars above roughly this mass are not supported by any known
#: equation of state; used only to sanity-check HasNS consistency.
MAX_NS_MASS_MSUN = 3.0


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def _classification(ev: dict[str, Any]) -> dict[str, float]:
    """Pull the classification block from any of the shapes GCN uses."""
    for key in ("classification", "properties", "probabilities"):
        blk = ev.get(key)
        if isinstance(blk, dict):
            out = {}
            for k, v in blk.items():
                n = _num(v)
                if n is not None:
                    out[k] = n
            if out:
                return out
    # Flattened onto the event itself.
    out = {}
    for k in PARTITION_KEYS + MARGINAL_KEYS:
        n = _num(ev.get(k))
        if n is not None:
            out[k] = n
    return out


def validate(ev: dict[str, Any], rep: ValidationReport) -> None:
    cls = _classification(ev)

    # ── Probability ranges ──────────────────────────────────────────────────
    for key, val in cls.items():
        if not (0.0 <= val <= 1.0):
            rep.error("gw_probability_out_of_range",
                      f"Classification probability {key} = {val} is outside [0, 1].",
                      key, val)

    # ── Partition sum (only where exhaustive) ───────────────────────────────
    present = {k: v for k, v in cls.items() if k in PARTITION_KEYS}
    if len(present) == len(PARTITION_KEYS):
        total = sum(present.values())
        if abs(total - 1.0) > PARTITION_TOLERANCE:
            rep.error("gw_partition_sum_invalid",
                      f"The exhaustive classification {PARTITION_KEYS} sums to "
                      f"{total:.3f}, not 1. The probabilities are inconsistent.",
                      "classification", round(total, 4))
    elif present:
        rep.notice("gw_partition_incomplete",
                   f"Only {sorted(present)} of the exhaustive classification "
                   f"{list(PARTITION_KEYS)} were reported; the set cannot be "
                   "checked for consistency and must not be normalised.",
                   "classification")

    # HasNS / HasRemnant are marginal — flag any attempt to treat them as part
    # of the partition, which would double-count neutron-star probability.
    for k in MARGINAL_KEYS:
        if k in cls and len(present) == len(PARTITION_KEYS):
            rep.info("gw_marginal_probability",
                     f"{k} = {cls[k]:.3f} is a marginal probability over the same "
                     "event, not a member of the classification partition; it must "
                     "not be included in the sum.", k, cls[k])

    # ── Masses ──────────────────────────────────────────────────────────────
    m1, m2 = _num(ev.get("mass1")), _num(ev.get("mass2"))
    mc = _num(ev.get("chirpMass"))

    for name, m in (("mass1", m1), ("mass2", m2), ("chirpMass", mc)):
        if m is not None and m <= 0:
            rep.error(f"gw_{name}_non_positive",
                      f"{name} {m} Msun is not positive.", name, m)

    if m1 is not None and m2 is not None and m1 > 0 and m2 > 0:
        if m2 > m1:
            rep.notice("gw_mass_ordering",
                       f"mass2 ({m2}) exceeds mass1 ({m1}); the convention is "
                       "m1 >= m2, so the components may be swapped.", "mass2", m2)
        light = Measurement.of(min(m1, m2), ev.get("mass2Error"))
        heavy = Measurement.of(max(m1, m2), ev.get("mass1Error"))
        q_m = light.over(heavy) if (light and heavy) else None
        q = min(m1, m2) / max(m1, m2)
        if q_m is not None and q_m.sigma is not None:
            # Component masses from one GW posterior are strongly correlated,
            # so the propagated error is an upper bound, not the posterior
            # width. Said out loud rather than presented as the true spread.
            rep.info("gw_mass_ratio",
                     f"Mass ratio q = {q_m.render(3)}. {INDEPENDENCE_CAVEAT}",
                     "mass2", round(q, 4))
        else:
            rep.info("gw_mass_ratio",
                     f"Mass ratio q = {q:.3f} (component uncertainties not "
                     "reported, so no error bar is given).", "mass2", round(q, 4))

        # Cross-check the reported chirp mass against the components.
        if mc is not None and mc > 0:
            derived = (m1 * m2) ** 0.6 / (m1 + m2) ** 0.2
            if derived > 0 and abs(derived - mc) / derived > 0.05:
                rep.error("gw_chirp_mass_inconsistent",
                          f"Reported chirp mass {mc:.3f} Msun disagrees with the "
                          f"value implied by the component masses ({derived:.3f} "
                          "Msun) by more than 5%.", "chirpMass", mc)

        # HasNS consistency: a high neutron-star probability with two clearly
        # black-hole-mass components is internally contradictory.
        has_ns = cls.get("HasNS")
        if has_ns is not None and has_ns > 0.5 and min(m1, m2) > MAX_NS_MASS_MSUN:
            rep.error("gw_hasns_inconsistent",
                      f"HasNS = {has_ns:.2f} but the lighter component is "
                      f"{min(m1, m2):.2f} Msun, above the maximum supported by any "
                      "known neutron-star equation of state.", "HasNS", has_ns)

    # ── Distance ────────────────────────────────────────────────────────────
    dl = _num(ev.get("luminosityDistance"))
    dl_err = _num(ev.get("luminosityDistanceError"))
    if dl is not None:
        if dl <= 0:
            rep.error("gw_distance_non_positive",
                      f"Luminosity distance {dl} Mpc is not positive.",
                      "luminosityDistance", dl)
        elif dl_err is None:
            rep.warning("gw_distance_no_uncertainty",
                        "Luminosity distance is reported without an uncertainty. "
                        "GW distance posteriors are broad; the point estimate alone "
                        "is not usable for follow-up prioritisation.",
                        "luminosityDistance", dl)

        if _num(ev.get("redshift")) is not None:
            rep.notice("gw_redshift_is_model_dependent",
                       "A redshift accompanies a luminosity distance. If it was "
                       "obtained by inverting the distance it is MODEL-DEPENDENT "
                       "(it assumes a cosmology) and must not be presented as a "
                       "spectroscopic redshift.", "redshift")
        elif dl > 0:
            # No redshift supplied. One CAN be obtained by inverting D_L under
            # the configured cosmology, so it is offered — but only as an
            # explicitly model-dependent estimate, never written into the
            # `redshift` field where it would be indistinguishable from a
            # spectroscopic measurement.
            st = cosmology.stamp()
            z_est = cosmology.redshift_from_luminosity_distance(dl)
            if z_est is not None:
                rep.info(
                    "gw_redshift_from_distance",
                    f"Inverting D_L = {dl:.0f} Mpc under {st.name} "
                    f"(H0 = {st.H0} km/s/Mpc, Om0 = {st.Om0}) gives z ~ "
                    f"{z_est:.4f}. This is MODEL-DEPENDENT and additionally "
                    "reflects only the median distance, not the median of the "
                    "redshift posterior; it is not stored as a measured "
                    "redshift.", "redshift", round(z_est, 5),
                )
            elif not st.available:
                rep.info(
                    "gw_redshift_not_derived",
                    f"A redshift was not derived from the distance: {st.reason}",
                    "redshift",
                )

    # ── Localization semantics (spec sections 16, 23) ───────────────────────
    area90 = _num(ev.get("area90Deg2"))
    area50 = _num(ev.get("area50Deg2"))
    if area90 is not None and area50 is not None:
        if area50 > area90:
            rep.error("gw_credible_area_inverted",
                      f"The 50% credible area ({area50:.1f} deg2) exceeds the 90% "
                      f"area ({area90:.1f} deg2); a smaller credible level cannot "
                      "enclose more sky.", "area50Deg2", area50)
    for fld, v in (("area90Deg2", area90), ("area50Deg2", area50)):
        if v is not None and v <= 0:
            rep.error(f"gw_{fld}_non_positive",
                      f"{fld} {v} deg2 is not positive.", fld, v)

    if area90 is not None and _num(ev.get("errorRadius")) is not None:
        rep.notice("gw_radius_vs_credible_region",
                   "Both an error radius and a 90% credible area are present. "
                   "These are different concepts — a credible region is generally "
                   "non-circular and often disjoint — and must not be used "
                   "interchangeably.", "errorRadius")

    # The equivalent radius makes a large area intelligible, but only as the
    # radius of a circle of the same area — never as a search radius, because
    # a GW skymap is typically an arc or several disjoint islands.
    if area90 is not None and area90 > 0:
        r_eq = area_to_radius_deg(area90)
        if r_eq is not None:
            rep.info(
                "gw_area90_equivalent_radius",
                f"The 90% credible area of {area90:.0f} deg2 is equivalent to a "
                f"circle of radius {r_eq:.2f} deg (spherical cap, "
                "A = 2*pi*(1 - cos r)). The real region is generally "
                "non-circular and may be disjoint, so this is a scale "
                "indicator, not a search radius.", "area90Deg2", round(r_eq, 4),
            )
