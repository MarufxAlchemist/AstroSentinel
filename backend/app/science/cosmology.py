"""
cosmology.py
------------
Explicit cosmological model configuration (spec section 33).

The spec's rule is that cosmological assumptions must NEVER be hidden. A
luminosity distance, a rest-frame energy or an E_iso is not a measurement — it
is a measurement *plus a model*, and two groups using Planck18 and WMAP9 will
publish different numbers from the same photons. So:

  * The active model is named, versioned and stamped onto every quantity
    derived from it. A consumer can always answer "under which cosmology?".
  * Nothing is derived when no cosmology is available. There is no fallback
    "typical" H0, because a silently-assumed 70 is exactly the kind of invented
    constant this layer exists to prevent.
  * The model is configurable (ASTROSENTINEL_COSMOLOGY), and an unrecognised
    configuration is a loud failure, not a quiet default.

Direction of derivation
───────────────────────
z -> distance is a well-posed model calculation. distance -> z is the same
model run backwards, and for GW events it inherits the distance posterior's
large asymmetric uncertainty; it is therefore always labelled MODEL-DEPENDENT
and never presented next to a spectroscopic redshift without that label.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any

from app.science.uncertainty import Measurement

#: Which model to use, by name. Planck18 is the default because it is the
#: current concordance analysis and is what LVK's own distance-redshift
#: conversions assume; the choice is recorded, not assumed.
DEFAULT_COSMOLOGY = "Planck18"

ENV_VAR = "ASTROSENTINEL_COSMOLOGY"

#: Models this layer will accept, with their published parameters. Values are
#: quoted so the stamp is complete even if astropy is unavailable.
KNOWN_MODELS: dict[str, dict[str, Any]] = {
    "Planck18": {
        "H0": 67.66, "Om0": 0.30966, "Ode0": 0.6889, "flat": True,
        "reference": "Planck Collaboration VI (2020), A&A 641, A6 — TT,TE,EE+lowE+lensing+BAO",
    },
    "Planck15": {
        "H0": 67.74, "Om0": 0.3075, "Ode0": 0.6910, "flat": True,
        "reference": "Planck Collaboration XIII (2016), A&A 594, A13",
    },
    "WMAP9": {
        "H0": 69.32, "Om0": 0.2865, "Ode0": 0.7134, "flat": True,
        "reference": "Hinshaw et al. (2013), ApJS 208, 19",
    },
}

#: erg per GeV, and cm per Mpc — needed for E_iso.
CM_PER_MPC = 3.0856775814913673e24


class CosmologyUnavailable(RuntimeError):
    """Raised only by strict callers; the public API returns None instead."""


@dataclass(frozen=True)
class CosmologyStamp:
    """The provenance block attached to every cosmology-derived quantity."""

    name: str
    H0: float
    Om0: float
    flat: bool
    reference: str
    available: bool
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "H0": self.H0,
            "Om0": self.Om0,
            "flat": self.flat,
            "reference": self.reference,
            "available": self.available,
            "units": {"H0": "km/s/Mpc"},
            **({"reason": self.reason} if self.reason else {}),
        }


def configured_name() -> str:
    return (os.getenv(ENV_VAR) or DEFAULT_COSMOLOGY).strip()


def _build() -> tuple[Any | None, CosmologyStamp]:
    """
    Resolve the configured cosmology.

    Returns (astropy_cosmology_or_None, stamp). A None cosmology is not an
    error path to be swallowed — every caller turns it into an explicit
    "not derived, and here is why".
    """
    name = configured_name()
    params = KNOWN_MODELS.get(name)

    if params is None:
        return None, CosmologyStamp(
            name=name, H0=float("nan"), Om0=float("nan"), flat=False,
            reference="unknown", available=False,
            reason=(f"{ENV_VAR}={name!r} is not a recognised cosmology. "
                    f"Known models: {', '.join(sorted(KNOWN_MODELS))}. "
                    "No cosmological quantity will be derived."),
        )

    try:
        from astropy.cosmology import FlatLambdaCDM
        cosmo = FlatLambdaCDM(H0=params["H0"], Om0=params["Om0"], name=name)
    except Exception as exc:                       # pragma: no cover - env dep
        return None, CosmologyStamp(
            name=name, H0=params["H0"], Om0=params["Om0"], flat=params["flat"],
            reference=params["reference"], available=False,
            reason=(f"astropy.cosmology is unavailable ({type(exc).__name__}: {exc}); "
                    "cosmological quantities cannot be computed and are reported "
                    "as UNKNOWN rather than approximated."),
        )

    return cosmo, CosmologyStamp(
        name=name, H0=params["H0"], Om0=params["Om0"], flat=params["flat"],
        reference=params["reference"], available=True,
    )


_CACHE: tuple[Any | None, CosmologyStamp] | None = None


def active() -> tuple[Any | None, CosmologyStamp]:
    """The configured cosmology and its stamp, built once per process."""
    global _CACHE
    if _CACHE is None:
        _CACHE = _build()
    return _CACHE


def reset_cache() -> None:
    """Re-read configuration — used by tests that vary the environment."""
    global _CACHE
    _CACHE = None


def stamp() -> CosmologyStamp:
    return active()[1]


def is_available() -> bool:
    return active()[0] is not None


# ---------------------------------------------------------------------------
# Derived quantities
# ---------------------------------------------------------------------------

#: Redshifts outside this range are not refused, but nothing is derived beyond
#: it: the models are calibrated for z >= 0 and no observed transient exceeds
#: z ~ 20.
Z_MIN, Z_MAX = 0.0, 20.0


def luminosity_distance_mpc(z: Any, z_sigma: Any = None) -> Measurement | None:
    """
    D_L(z) under the configured cosmology, with the redshift error propagated
    numerically. Returns None when z is unusable or no cosmology is available.
    """
    cosmo, _ = active()
    zz = _finite(z)
    if cosmo is None or zz is None or not (Z_MIN <= zz <= Z_MAX):
        return None
    try:
        d = float(cosmo.luminosity_distance(zz).value)
    except Exception:                              # pragma: no cover
        return None

    zs = _finite(z_sigma)
    if zs is None or zs <= 0:
        return Measurement(d, None)

    # dD_L/dz by symmetric difference, clipped to the valid domain.
    h = max(1e-4, zs * 1e-2)
    lo, hi = max(Z_MIN, zz - h), min(Z_MAX, zz + h)
    if hi <= lo:
        return Measurement(d, None)
    try:
        d_lo = float(cosmo.luminosity_distance(lo).value)
        d_hi = float(cosmo.luminosity_distance(hi).value)
    except Exception:                              # pragma: no cover
        return Measurement(d, None)
    slope = (d_hi - d_lo) / (hi - lo)
    return Measurement(d, abs(slope) * zs)


def comoving_distance_mpc(z: Any) -> float | None:
    cosmo, _ = active()
    zz = _finite(z)
    if cosmo is None or zz is None or not (Z_MIN <= zz <= Z_MAX):
        return None
    try:
        return float(cosmo.comoving_distance(zz).value)
    except Exception:                              # pragma: no cover
        return None


def lookback_time_gyr(z: Any) -> float | None:
    cosmo, _ = active()
    zz = _finite(z)
    if cosmo is None or zz is None or not (Z_MIN <= zz <= Z_MAX):
        return None
    try:
        return float(cosmo.lookback_time(zz).value)
    except Exception:                              # pragma: no cover
        return None


def redshift_from_luminosity_distance(dl_mpc: Any) -> float | None:
    """
    Invert D_L(z) for the configured cosmology.

    MODEL-DEPENDENT in both directions and doubly so here: a GW distance
    posterior is wide and asymmetric, so the single number returned is the
    redshift *of the median distance*, not the median of the redshift
    posterior. Callers must label it, never present it as a measured redshift,
    and never use it where a spectroscopic z is required.
    """
    cosmo, _ = active()
    d = _finite(dl_mpc)
    if cosmo is None or d is None or d <= 0:
        return None
    try:
        from astropy.cosmology import z_at_value
        import astropy.units as u
        return float(z_at_value(cosmo.luminosity_distance, d * u.Mpc,
                                zmin=1e-8, zmax=Z_MAX))
    except Exception:
        return None


def eiso_band_limited(
    fluence_erg_cm2: Any,
    z: Any,
    fluence_sigma: Any = None,
    z_sigma: Any = None,
) -> tuple[Measurement | None, str]:
    """
    Isotropic-equivalent energy released in the *observed* band.

        E_iso,band = 4 * pi * D_L(z)^2 * S / (1 + z)

    This is NOT the bolometric E_iso quoted in GRB catalogues. That requires a
    k-correction from the observed band into a fixed rest-frame band
    (conventionally 1-10000 keV), which needs a fitted spectral model this
    pipeline does not receive. The two differ by a factor that is typically
    1.5-5 and is not a constant.

    Returned with the caveat text so the number can never be displayed without
    it. Returns (None, reason) when it cannot be computed.
    """
    s = _finite(fluence_erg_cm2)
    zz = _finite(z)
    if s is None or s <= 0:
        return None, "No positive fluence reported."
    if zz is None:
        return None, "No redshift reported; E_iso requires a distance."
    if not (Z_MIN < zz <= Z_MAX):
        return None, f"Redshift {zz} is outside the range where a distance is derived."

    dl = luminosity_distance_mpc(zz, z_sigma)
    if dl is None:
        st = stamp()
        return None, (st.reason or "No cosmology available; E_iso cannot be derived.")

    d_cm = Measurement(dl.value * CM_PER_MPC,
                       None if dl.sigma is None else dl.sigma * CM_PER_MPC)
    d_sq = d_cm.powed(2)
    if d_sq is None:
        return None, "Distance could not be squared."

    fl = Measurement.of(s, fluence_sigma)
    if fl is None:
        return None, "Fluence is not a finite number."

    e = d_sq.scaled(4.0 * math.pi).times(fl).scaled(1.0 / (1.0 + zz))
    return e, EISO_CAVEAT


EISO_CAVEAT = (
    "Band-limited isotropic-equivalent energy: 4*pi*D_L^2*S/(1+z) using the "
    "fluence in the instrument's own energy band. This is NOT the bolometric "
    "E_iso of the literature, which additionally requires a k-correction to a "
    "fixed rest-frame band (typically 1-10000 keV) from a fitted spectral "
    "model. Isotropy is assumed; a collimated outflow releases far less."
)


def _finite(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


__all__ = [
    "DEFAULT_COSMOLOGY", "ENV_VAR", "KNOWN_MODELS", "EISO_CAVEAT",
    "CM_PER_MPC", "Z_MIN", "Z_MAX",
    "CosmologyStamp", "CosmologyUnavailable",
    "active", "stamp", "is_available", "configured_name", "reset_cache",
    "luminosity_distance_mpc", "comoving_distance_mpc", "lookback_time_gyr",
    "redshift_from_luminosity_distance", "eiso_band_limited",
]
