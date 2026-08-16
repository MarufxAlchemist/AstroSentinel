"""
uncertainty.py
--------------
Uncertainty propagation and localization semantics (spec sections 23-24).

Why this module exists
──────────────────────
Two distinct failures motivated it, and both are already present in real GCN
payloads:

  1. **A derived quantity was reported without its error.** Rest-frame T90,
     DM excess and mass ratio were all computed in Phase 4 as bare numbers.
     A derived value whose inputs carry uncertainties has an uncertainty too;
     printing only the central value overstates what is known.

  2. **A localization radius was quoted without saying what it contains.**
     "5 degrees" is not a measurement until you know whether it is a 1-sigma
     statistical error, a 90% containment radius, or a systematic-inclusive
     bound — those differ from each other by more than a factor of two. Worse,
     "68% containment" of a 2-D sky localization is 1.515 sigma, NOT 1 sigma;
     treating them as the same is a 50% error that looks like a rounding
     difference.

Propagation model
─────────────────
First-order (linear) propagation, assuming **independent** inputs. That
assumption is stated on every result rather than hidden, because it is wrong
for genuinely correlated quantities (m1 and m2 from the same GW fit are
strongly correlated, so a propagated chirp-mass error is an upper bound, not
the posterior width). Where correlation is known it can be supplied; where it
is not, the result says so instead of pretending.

Nothing here invents an uncertainty. If an input has no reported sigma, the
result has no sigma — it is a central value with unknown error, and it is
labelled that way.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist
from typing import Any

# ---------------------------------------------------------------------------
# Localization semantics (spec section 23)
# ---------------------------------------------------------------------------

#: Square degrees in the whole sky — 4*pi sr expressed in deg^2.
FULL_SKY_DEG2 = 4.0 * math.pi * (180.0 / math.pi) ** 2      # 41252.96

#: Containment conventions seen in alert streams, and what they mean.
#: `dim` is the dimensionality of the Gaussian the fraction refers to: a sky
#: localization is 2-D, a single-axis error bar is 1-D. This is the field that
#: is most often dropped, and dropping it silently rescales the region.
CONTAINMENT_CONVENTIONS: dict[str, dict[str, Any]] = {
    "1SIGMA_1D": {"fraction": 0.6827, "dim": 1,
                  "label": "1 sigma (68.27%, one-dimensional)"},
    "1SIGMA_2D": {"fraction": 0.3935, "dim": 2,
                  "label": "1 sigma radius of a 2-D Gaussian (contains 39.35%)"},
    "50_2D":     {"fraction": 0.50, "dim": 2, "label": "50% credible region"},
    "68_2D":     {"fraction": 0.6827, "dim": 2, "label": "68.27% containment (2-D)"},
    "90_2D":     {"fraction": 0.90, "dim": 2, "label": "90% credible region"},
    "95_2D":     {"fraction": 0.95, "dim": 2, "label": "95% credible region"},
}


def containment_scale(fraction: float, dim: int = 2) -> float | None:
    """
    Multiples of sigma enclosing `fraction` of the probability.

    2-D (Rayleigh, circular Gaussian):  R = sigma * sqrt(-2 ln(1 - P))
    1-D (Gaussian):                     R = sigma * Phi^-1((1 + P) / 2)

    The two differ substantially and are the reason `dim` is mandatory in
    spirit even though it defaults to the sky-localization case:

        P = 0.6827  ->  1.000 sigma (1-D)   but  1.515 sigma (2-D)
        P = 0.90    ->  1.645 sigma (1-D)   but  2.146 sigma (2-D)
    """
    if not (0.0 < fraction < 1.0):
        return None
    if dim == 2:
        return math.sqrt(-2.0 * math.log(1.0 - fraction))
    if dim == 1:
        return NormalDist().inv_cdf((1.0 + fraction) / 2.0)
    return None


def convert_containment(
    radius: float,
    from_fraction: float,
    to_fraction: float,
    dim: int = 2,
) -> float | None:
    """
    Rescale a containment radius between confidence levels.

    Valid only for a symmetric Gaussian/Rayleigh region. Real GW skymaps are
    neither circular nor Gaussian, so this must not be applied to them — the
    caller is responsible for that judgement, and `describe_region` records it.
    """
    a = containment_scale(from_fraction, dim)
    b = containment_scale(to_fraction, dim)
    if a is None or b is None or a == 0 or radius is None:
        return None
    return radius * b / a


def area_to_radius_deg(area_deg2: float) -> float | None:
    """
    Effective radius of a circular sky region of the given area.

    Uses the spherical-cap relation A = 2*pi*(1 - cos r), not the flat-sky
    A = pi*r^2. For a 1000 deg^2 region the two agree to 0.1%, but for a
    20000 deg^2 region the flat formula understates the radius by ~10% — and
    poorly-localized GW events routinely reach that size.

    The result is an *equivalent* radius: it describes a circle of the same
    area, not the actual (usually multi-lobed) region.
    """
    if area_deg2 is None or area_deg2 <= 0 or area_deg2 > FULL_SKY_DEG2:
        return None
    deg_per_rad = 180.0 / math.pi
    area_sr = area_deg2 / (deg_per_rad ** 2)
    cos_r = 1.0 - area_sr / (2.0 * math.pi)
    # The area is already range-checked above, so mathematically cos_r lies in
    # [-1, 1]; any excursion is float error alone (the whole sky evaluates to
    # -1.0000000000000002). Clamp rather than reject — a completely
    # unlocalized event is a real case and its radius is 180 deg, not UNKNOWN.
    cos_r = max(-1.0, min(1.0, cos_r))
    return math.acos(cos_r) * deg_per_rad


def radius_to_area_deg2(radius_deg: float) -> float | None:
    """Area of a spherical cap of the given angular radius, in deg^2."""
    if radius_deg is None or radius_deg < 0 or radius_deg > 180.0:
        return None
    deg_per_rad = 180.0 / math.pi
    r = radius_deg / deg_per_rad
    return 2.0 * math.pi * (1.0 - math.cos(r)) * (deg_per_rad ** 2)


@dataclass(frozen=True)
class Region:
    """What a quoted localization actually means."""

    radius_deg: float | None
    convention: str | None          # key into CONTAINMENT_CONVENTIONS
    #: True when systematic error is included in the quoted number.
    includes_systematic: bool | None = None
    area_deg2: float | None = None
    note: str | None = None

    @property
    def fraction(self) -> float | None:
        c = CONTAINMENT_CONVENTIONS.get(self.convention or "")
        return c["fraction"] if c else None

    @property
    def well_defined(self) -> bool:
        """A radius without a stated convention is not a scientific quantity."""
        return self.radius_deg is not None and self.convention is not None

    def to_dict(self) -> dict[str, Any]:
        c = CONTAINMENT_CONVENTIONS.get(self.convention or "")
        return {
            "radiusDeg": self.radius_deg,
            "areaDeg2": self.area_deg2,
            "convention": self.convention,
            "conventionLabel": c["label"] if c else None,
            "containedFraction": self.fraction,
            "includesSystematic": self.includes_systematic,
            "wellDefined": self.well_defined,
            "note": self.note,
        }


# ---------------------------------------------------------------------------
# Error propagation (spec section 24)
# ---------------------------------------------------------------------------

def _finite(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


@dataclass(frozen=True)
class Measurement:
    """
    A central value with an optional 1-sigma uncertainty.

    `sigma is None` means the uncertainty is UNKNOWN, which is propagated
    honestly: any quantity derived from it also has an unknown uncertainty.
    It never degrades to zero, because a zero error bar is a claim of perfect
    knowledge.
    """

    value: float
    sigma: float | None = None
    #: Set once a result has passed through an operation whose inputs were
    #: assumed independent, so consumers can qualify the number.
    assumed_independent: bool = False

    # ── construction ────────────────────────────────────────────────────────

    @staticmethod
    def of(value: Any, sigma: Any = None) -> "Measurement | None":
        v = _finite(value)
        if v is None:
            return None
        s = _finite(sigma)
        if s is not None and s < 0:
            s = None                      # a negative error bar is meaningless
        return Measurement(v, s)

    # ── helpers ─────────────────────────────────────────────────────────────

    @property
    def relative(self) -> float | None:
        if self.sigma is None or self.value == 0:
            return None
        return abs(self.sigma / self.value)

    def _combine(self, value: float, sigma: float | None, independent: bool) -> "Measurement":
        return Measurement(value, sigma, assumed_independent=independent)

    # ── arithmetic ──────────────────────────────────────────────────────────

    def scaled(self, k: float) -> "Measurement":
        """Multiplication by an exact constant — no independence assumption."""
        return Measurement(self.value * k,
                           None if self.sigma is None else abs(self.sigma * k),
                           self.assumed_independent)

    def shifted(self, k: float) -> "Measurement":
        """Addition of an exact constant leaves the uncertainty unchanged."""
        return Measurement(self.value + k, self.sigma, self.assumed_independent)

    def plus(self, other: "Measurement", cov: float = 0.0) -> "Measurement":
        v = self.value + other.value
        s = _quad_sum(self.sigma, other.sigma, cov, +1)
        return self._combine(v, s, cov == 0.0)

    def minus(self, other: "Measurement", cov: float = 0.0) -> "Measurement":
        v = self.value - other.value
        s = _quad_sum(self.sigma, other.sigma, cov, -1)
        return self._combine(v, s, cov == 0.0)

    def times(self, other: "Measurement") -> "Measurement":
        v = self.value * other.value
        if self.sigma is None or other.sigma is None:
            return self._combine(v, None, True)
        s = math.sqrt((other.value * self.sigma) ** 2 + (self.value * other.sigma) ** 2)
        return self._combine(v, s, True)

    def over(self, other: "Measurement") -> "Measurement | None":
        if other.value == 0:
            return None
        v = self.value / other.value
        if self.sigma is None or other.sigma is None:
            return self._combine(v, None, True)
        # Written out in absolute terms rather than via relative errors so a
        # zero numerator (a legitimate central value) is handled correctly.
        term_a = (self.sigma / other.value) ** 2
        term_b = (self.value * other.sigma / other.value ** 2) ** 2
        return self._combine(v, math.sqrt(term_a + term_b), True)

    def powed(self, n: float) -> "Measurement | None":
        """x^n — sigma_y/|y| = |n| * sigma_x/|x|."""
        if self.value < 0 and not float(n).is_integer():
            return None
        try:
            v = self.value ** n
        except (OverflowError, ValueError, ZeroDivisionError):
            return None
        if self.sigma is None:
            return self._combine(v, None, self.assumed_independent)
        if self.value == 0:
            return self._combine(v, None, self.assumed_independent)
        s = abs(n) * abs(v) * abs(self.sigma / self.value)
        return self._combine(v, s, self.assumed_independent)

    # ── output ──────────────────────────────────────────────────────────────

    def to_dict(self, unit: str | None = None) -> dict[str, Any]:
        return {
            "value": self.value,
            "sigma": self.sigma,
            "unit": unit,
            "relative": self.relative,
            "uncertaintyKnown": self.sigma is not None,
            "assumedIndependent": self.assumed_independent,
        }

    def render(self, digits: int = 3, unit: str = "") -> str:
        tail = f" {unit}".rstrip()
        if self.sigma is None:
            return f"{self.value:.{digits}g} (uncertainty unknown){tail}"
        return f"{self.value:.{digits}g} +/- {self.sigma:.{digits}g}{tail}"


def _quad_sum(a: float | None, b: float | None, cov: float, sign: int) -> float | None:
    """Quadrature sum for a sum/difference, with an optional covariance term."""
    if a is None or b is None:
        return None
    var = a * a + b * b + 2.0 * sign * cov
    return math.sqrt(var) if var > 0 else 0.0


def propagate_ratio(num: Any, num_sig: Any, den: Any, den_sig: Any) -> Measurement | None:
    """Convenience wrapper used by the messenger validators."""
    a = Measurement.of(num, num_sig)
    b = Measurement.of(den, den_sig)
    if a is None or b is None:
        return None
    return a.over(b)


#: Standard caveat attached to any propagated result whose inputs were assumed
#: independent. Stated, not hidden — for correlated inputs it is an upper bound.
INDEPENDENCE_CAVEAT = (
    "Uncertainty propagated to first order assuming independent inputs. "
    "For correlated quantities (e.g. component masses from a single GW "
    "posterior) this is an upper bound, not the posterior width."
)


__all__ = [
    "FULL_SKY_DEG2", "CONTAINMENT_CONVENTIONS", "INDEPENDENCE_CAVEAT",
    "Measurement", "Region",
    "containment_scale", "convert_containment",
    "area_to_radius_deg", "radius_to_area_deg2", "propagate_ratio",
]
