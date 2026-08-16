"""
units.py
--------
Canonical unit system for astrophysical quantities (spec section 34).

Two rules govern everything here:

  1. **A unit is never guessed.** If a value arrives without a unit, or with a
     unit this module does not recognise, the conversion returns None and the
     caller must report the quantity as uninterpretable. Silently assuming
     "it's probably TeV" is how a 1000x error enters a catalogue.

  2. **The original is never destroyed.** Converting to canonical units is
     additive: a Quantity carries both what the source said and what it means
     canonically, so a researcher can always audit back to the notice.

Canonical unit per dimension
────────────────────────────
    ANGLE          deg          sky separations, localization radii
    SOLID_ANGLE    deg2         credible-region areas
    TIME           s
    ENERGY         GeV          (keV/MeV/erg all convert into it)
    FLUENCE        erg/cm2
    FLUX           erg/(cm2 s)
    DISTANCE       Mpc
    DISPERSION     pc/cm3
    MASS           Msun
    RATE           Hz           false-alarm rates

GeV is canonical for energy because it is the natural scale for the
particle-astrophysics side (IceCube) and keeps this module consistent with the
neutrino validator written in Phase 4. Photon energies are still *reported* in
keV and isotropic energies in erg — canonicalisation is for comparison and
range-checking, not for display.

Case sensitivity
────────────────
Unit symbols are case-significant in physics: `mas` is a milliarcsecond and
`Mpc` is a megaparsec, but `MAS` and `mpc` are not the same things. Exact
matches are taken first. A case-insensitive match is accepted only when it is
unambiguous; where two real units differ only by case, the input is rejected as
ambiguous rather than resolved by guessing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Dimensions and canonical units
# ---------------------------------------------------------------------------

CANONICAL: dict[str, str] = {
    "ANGLE": "deg",
    "SOLID_ANGLE": "deg2",
    "TIME": "s",
    "ENERGY": "GeV",
    "FLUENCE": "erg/cm2",
    "FLUX": "erg/(cm2 s)",
    "DISTANCE": "Mpc",
    "DISPERSION": "pc/cm3",
    "MASS": "Msun",
    "RATE": "Hz",
}

#: unit symbol -> (dimension, factor to the canonical unit of that dimension)
#:
#: Only multiplicative units appear here. Anything needing an offset (a
#: temperature scale, a magnitude system) or a model (a redshift-to-distance
#: conversion) is deliberately absent: those are not unit conversions and must
#: not be performed by a lookup table.
UNITS: dict[str, tuple[str, float]] = {
    # ── angle ───────────────────────────────────────────────────────────────
    "deg":      ("ANGLE", 1.0),
    "degree":   ("ANGLE", 1.0),
    "degrees":  ("ANGLE", 1.0),
    "arcmin":   ("ANGLE", 1.0 / 60.0),
    "arcminute": ("ANGLE", 1.0 / 60.0),
    "'":        ("ANGLE", 1.0 / 60.0),
    "arcsec":   ("ANGLE", 1.0 / 3600.0),
    "arcsecond": ("ANGLE", 1.0 / 3600.0),
    '"':        ("ANGLE", 1.0 / 3600.0),
    "mas":      ("ANGLE", 1.0 / 3.6e6),
    "rad":      ("ANGLE", 180.0 / math.pi),
    "radian":   ("ANGLE", 180.0 / math.pi),

    # ── solid angle ─────────────────────────────────────────────────────────
    "deg2":     ("SOLID_ANGLE", 1.0),
    "deg^2":    ("SOLID_ANGLE", 1.0),
    "sqdeg":    ("SOLID_ANGLE", 1.0),
    "sr":       ("SOLID_ANGLE", (180.0 / math.pi) ** 2),
    "arcmin2":  ("SOLID_ANGLE", 1.0 / 3600.0),

    # ── time ────────────────────────────────────────────────────────────────
    "s":        ("TIME", 1.0),
    "sec":      ("TIME", 1.0),
    "second":   ("TIME", 1.0),
    "ms":       ("TIME", 1e-3),
    "us":       ("TIME", 1e-6),
    "ns":       ("TIME", 1e-9),
    "min":      ("TIME", 60.0),
    "h":        ("TIME", 3600.0),
    "hr":       ("TIME", 3600.0),
    "d":        ("TIME", 86400.0),
    "day":      ("TIME", 86400.0),

    # ── energy ──────────────────────────────────────────────────────────────
    "eV":       ("ENERGY", 1e-9),
    "keV":      ("ENERGY", 1e-6),
    "MeV":      ("ENERGY", 1e-3),
    "GeV":      ("ENERGY", 1.0),
    "TeV":      ("ENERGY", 1e3),
    "PeV":      ("ENERGY", 1e6),
    "EeV":      ("ENERGY", 1e9),
    "erg":      ("ENERGY", 624.150907),          # 1 erg = 624.150907 GeV
    "J":        ("ENERGY", 6.24150907e9),

    # ── fluence ─────────────────────────────────────────────────────────────
    "erg/cm2":   ("FLUENCE", 1.0),
    "erg/cm^2":  ("FLUENCE", 1.0),
    "erg cm-2":  ("FLUENCE", 1.0),
    "J/m2":      ("FLUENCE", 1e3),               # 1 J/m2 = 1e3 erg/cm2

    # ── flux ────────────────────────────────────────────────────────────────
    "erg/cm2/s":  ("FLUX", 1.0),
    "erg/cm^2/s": ("FLUX", 1.0),
    "erg/(cm2 s)": ("FLUX", 1.0),

    # ── distance ────────────────────────────────────────────────────────────
    "pc":       ("DISTANCE", 1e-6),
    "kpc":      ("DISTANCE", 1e-3),
    "Mpc":      ("DISTANCE", 1.0),
    "Gpc":      ("DISTANCE", 1e3),
    "ly":       ("DISTANCE", 3.066013938e-7),
    "cm":       ("DISTANCE", 3.240779289e-25),

    # ── dispersion measure ──────────────────────────────────────────────────
    "pc/cm3":   ("DISPERSION", 1.0),
    "pc cm-3":  ("DISPERSION", 1.0),
    "pc/cm^3":  ("DISPERSION", 1.0),

    # ── mass ────────────────────────────────────────────────────────────────
    "Msun":     ("MASS", 1.0),
    "M_sun":    ("MASS", 1.0),
    "solMass":  ("MASS", 1.0),
    "kg":       ("MASS", 5.0279e-31),

    # ── rate ────────────────────────────────────────────────────────────────
    "Hz":       ("RATE", 1.0),
    "1/s":      ("RATE", 1.0),
    "1/yr":     ("RATE", 1.0 / 3.15576e7),
    "1/day":    ("RATE", 1.0 / 86400.0),
}

#: Lower-cased symbol -> the real symbols that collapse onto it. Any entry with
#: more than one member cannot be resolved case-insensitively.
_FOLDED: dict[str, list[str]] = {}
for _sym in UNITS:
    _FOLDED.setdefault(_sym.lower(), []).append(_sym)

#: Symbols whose lower-cased form is shared by two genuinely different units.
AMBIGUOUS_FOLDS = {k for k, v in _FOLDED.items() if len(v) > 1}


class UnitError(ValueError):
    """Raised only by the strict helpers; the normal API returns None."""


def _clean(unit: Any) -> str | None:
    if unit is None:
        return None
    if not isinstance(unit, str):
        return None
    s = unit.strip()
    return s or None


def resolve(unit: Any) -> tuple[str, str, float] | None:
    """
    Resolve a unit symbol to (canonical_symbol, dimension, factor).

    Returns None when the unit is absent, unrecognised, or ambiguous under
    case-folding. The caller must treat None as "uninterpretable" — never as a
    licence to assume a default.
    """
    s = _clean(unit)
    if s is None:
        return None

    if s in UNITS:                      # exact match always wins
        dim, factor = UNITS[s]
        return s, dim, factor

    folded = s.lower()
    if folded in AMBIGUOUS_FOLDS:       # e.g. two real units differing by case
        return None
    matches = _FOLDED.get(folded)
    if matches and len(matches) == 1:
        sym = matches[0]
        dim, factor = UNITS[sym]
        return sym, dim, factor
    return None


def dimension_of(unit: Any) -> str | None:
    r = resolve(unit)
    return r[1] if r else None


def to_canonical(value: Any, unit: Any) -> float | None:
    """
    Convert `value` from `unit` into the canonical unit of its dimension.

    Returns None if the value is not a finite number or the unit cannot be
    resolved. A None result means UNKNOWN, not zero.
    """
    v = _finite(value)
    if v is None:
        return None
    r = resolve(unit)
    if r is None:
        return None
    return v * r[2]


def convert(value: Any, from_unit: Any, to_unit: Any) -> float | None:
    """
    Convert between two units of the same dimension.

    Returns None if either unit is unresolvable **or if the dimensions differ**.
    A cross-dimension conversion is not a rounding error to be papered over: it
    means two different physical quantities have been confused, which is the
    failure this module exists to catch.
    """
    v = _finite(value)
    if v is None:
        return None
    a, b = resolve(from_unit), resolve(to_unit)
    if a is None or b is None:
        return None
    if a[1] != b[1]:
        return None
    return v * a[2] / b[2]


def same_dimension(a: Any, b: Any) -> bool | None:
    """True/False, or None when either unit cannot be resolved."""
    ra, rb = resolve(a), resolve(b)
    if ra is None or rb is None:
        return None
    return ra[1] == rb[1]


def _finite(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


# ---------------------------------------------------------------------------
# Quantity
# ---------------------------------------------------------------------------

#: Provenance vocabulary shared with the rest of the science layer.
PROVENANCE = ("OBSERVED", "DERIVED", "INFERRED", "CATALOG", "UNKNOWN")


@dataclass(frozen=True)
class Quantity:
    """
    A number that knows what it is, where it came from, and what it cost.

    `value`/`unit` are always exactly what the source reported. `canonical`
    is the same quantity in this module's canonical unit, or None when the
    unit could not be resolved — in which case `interpretable` is False and
    the quantity must not be compared with anything.
    """

    value: float | None
    unit: str | None = None
    provenance: str = "OBSERVED"
    #: 1-sigma uncertainty in the *same unit as `value`*, when reported.
    sigma: float | None = None
    #: Free-text note carried to the UI (method, caveat, assumption).
    note: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    # ── derived views ───────────────────────────────────────────────────────

    @property
    def dimension(self) -> str | None:
        return dimension_of(self.unit)

    @property
    def canonical(self) -> float | None:
        return to_canonical(self.value, self.unit)

    @property
    def canonical_unit(self) -> str | None:
        dim = self.dimension
        return CANONICAL.get(dim) if dim else None

    @property
    def known(self) -> bool:
        return _finite(self.value) is not None

    @property
    def interpretable(self) -> bool:
        """A number without a resolvable unit cannot be compared or converted."""
        return self.known and self.canonical is not None

    def to(self, unit: str) -> float | None:
        return convert(self.value, self.unit, unit)

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "unit": self.unit,
            "canonical": self.canonical,
            "canonicalUnit": self.canonical_unit,
            "dimension": self.dimension,
            "provenance": self.provenance,
            "sigma": self.sigma,
            "interpretable": self.interpretable,
            "note": self.note,
            **({"meta": self.meta} if self.meta else {}),
        }


def unknown(note: str, provenance: str = "UNKNOWN") -> Quantity:
    """
    An explicitly absent quantity carrying the reason it is absent.

    This is the value the spec demands in place of a guess: the UI renders it
    as UNKNOWN with the note explaining what would be needed to derive it.
    """
    return Quantity(value=None, unit=None, provenance=provenance, note=note)


__all__ = [
    "CANONICAL", "UNITS", "AMBIGUOUS_FOLDS", "PROVENANCE",
    "Quantity", "UnitError",
    "resolve", "dimension_of", "to_canonical", "convert", "same_dimension",
    "unknown",
]
