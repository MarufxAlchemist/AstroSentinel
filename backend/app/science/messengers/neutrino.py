"""
neutrino.py
-----------
High-energy neutrino validation (spec section 18).

Energy units are the hazard here. IceCube alerts quote energies in GeV, TeV or
PeV depending on the stream, and the three differ by factors of 1000. Silently
interpreting one as another would misstate an event's energy by six orders of
magnitude, so this module never guesses: it converts only when the unit is
explicitly stated, and flags the ambiguity when it is not.

Signalness is also kept strictly distinct from SNR. It is P(astrophysical),
a probability in [0, 1] — not a detection significance in sigma. Conflating
the two is the defect Phase 2 removed from the normalizer.
"""

from __future__ import annotations

from typing import Any

from app.science.diagnostics import ValidationReport
from app.science.units import dimension_of, to_canonical

#: Multipliers into GeV, the canonical energy unit. Kept for reference and for
#: the plausibility ranges below; the conversion itself goes through the shared
#: registry in app.science.units so there is a single source of truth.
ENERGY_UNITS_GEV = {
    "GEV": 1.0,
    "TEV": 1e3,
    "PEV": 1e6,
    "EEV": 1e9,
    "MEV": 1e-3,
}

#: IceCube alert energies span roughly 100 GeV to 10 EeV.
ENERGY_MIN_GEV, ENERGY_MAX_GEV = 1e2, 1e10

#: Alert-stream tiers. GOLD implies a higher signalness threshold than BRONZE.
VALID_TIERS = {"GOLD", "BRONZE"}

#: IceCube's nominal thresholds for the two tiers.
TIER_MIN_SIGNALNESS = {"GOLD": 0.5, "BRONZE": 0.3}


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def to_gev(value: float, unit: str | None) -> float | None:
    """
    Convert to GeV, or None if the unit is missing or unknown. Never guesses.

    Delegates to the shared unit registry (spec section 34) so there is one
    conversion table in the codebase rather than a private copy per messenger.
    The dimension is checked explicitly: an angle or a distance labelled onto
    an energy field must not silently convert to a number of GeV.
    """
    if not unit:
        return None
    if dimension_of(unit) != "ENERGY":
        return None
    return to_canonical(value, unit)


def validate(ev: dict[str, Any], rep: ValidationReport) -> None:
    # ── Signalness ──────────────────────────────────────────────────────────
    sig = _num(ev.get("signalness"))
    if sig is None:
        rep.warning("nu_signalness_missing",
                    "No signalness reported. Without P(astrophysical) the "
                    "event cannot be weighed against the atmospheric background.",
                    "signalness")
    elif not (0.0 <= sig <= 1.0):
        rep.error("nu_signalness_out_of_range",
                  f"Signalness {sig} is outside [0, 1]; it is a probability, "
                  "not a signal-to-noise ratio.", "signalness", sig)

    if _num(ev.get("snr")) is not None:
        rep.notice("nu_snr_reported",
                   "An SNR is present on a neutrino alert. IceCube reports "
                   "signalness, a probability, rather than a detection "
                   "significance in sigma — verify the two have not been "
                   "conflated.", "snr", ev.get("snr"))

    # ── Classification tier ─────────────────────────────────────────────────
    tier = ev.get("classificationTier")
    if tier:
        t = str(tier).strip().upper()
        if t not in VALID_TIERS:
            rep.error("nu_tier_invalid",
                      f"Classification tier '{tier}' is not one of {sorted(VALID_TIERS)}.",
                      "classificationTier", tier)
        elif sig is not None and sig < TIER_MIN_SIGNALNESS[t]:
            rep.warning("nu_tier_signalness_mismatch",
                        f"Tier {t} normally requires signalness >= "
                        f"{TIER_MIN_SIGNALNESS[t]}, but {sig:.3f} was reported.",
                        "classificationTier", tier)

    # ── Energy and its unit ─────────────────────────────────────────────────
    energy = _num(ev.get("energy"))
    unit = ev.get("energyUnit") or ev.get("energy_unit")

    if energy is not None:
        if energy <= 0:
            rep.error("nu_energy_non_positive",
                      f"Neutrino energy {energy} is not positive.", "energy", energy)
        elif not unit:
            # Refusing to guess is the whole point: GeV/TeV/PeV differ by 10^3.
            rep.warning("nu_energy_unit_unknown",
                        f"Energy {energy} is reported without a unit. GeV, TeV and "
                        "PeV differ by factors of 1000, so the value is not "
                        "interpretable and has not been converted.", "energy", energy)
        else:
            gev = to_gev(energy, unit)
            if gev is None:
                rep.error("nu_energy_unit_unrecognised",
                          f"Energy unit '{unit}' is not recognised; the value was "
                          "not converted rather than assumed.", "energyUnit", unit)
            elif not (ENERGY_MIN_GEV <= gev <= ENERGY_MAX_GEV):
                rep.warning("nu_energy_implausible",
                            f"Energy {energy} {unit} = {gev:.3e} GeV lies outside "
                            "the range of IceCube alert events; check the unit.",
                            "energy", gev)
            else:
                rep.info("nu_energy_canonical",
                         f"Energy {energy} {unit} = {gev:.3e} GeV.", "energy", gev)

    # ── Angular uncertainty ─────────────────────────────────────────────────
    err = _num(ev.get("errorRadius"))
    if err is not None and err > 0:
        # Track events localise to well under a degree; cascades are far worse.
        if err > 600.0:  # arcmin == 10 deg
            rep.notice("nu_localization_coarse",
                       f"Angular uncertainty {err/60:.1f} deg is large even for a "
                       "cascade event; electromagnetic follow-up will need wide-"
                       "field tiling.", "errorRadius", err)

    # ── Event topology ──────────────────────────────────────────────────────
    topo = ev.get("topology") or ev.get("eventTopology")
    if topo:
        t = str(topo).strip().lower()
        if t not in {"track", "cascade", "shower", "double-bang"}:
            rep.notice("nu_topology_unrecognised",
                       f"Event topology '{topo}' is not a recognised IceCube "
                       "classification.", "topology", topo)
        elif t in {"cascade", "shower"} and err is not None and err < 60.0:
            rep.warning("nu_cascade_localization_suspicious",
                        f"A {t} event is reported with a {err:.1f} arcmin "
                        "uncertainty. Cascades localise far more poorly than "
                        "tracks; verify the value.", "errorRadius", err)
