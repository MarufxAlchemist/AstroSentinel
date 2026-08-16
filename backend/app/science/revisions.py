"""
revisions.py
------------
Scientific delta detection between successive notices for one event
(spec sections 27-28).

Why this layer exists
─────────────────────
Until now a revision was applied by an UPSERT that overwrote the previous row
and incremented a counter. That destroys the scientific history: if a GW
localization moves 40 degrees between the preliminary and updated notice,
nothing anywhere records that it moved. The event simply *is* wherever the
latest notice put it, and a researcher who acted on the first position has no
way to learn that it changed.

So this module answers one question about every new notice: **what changed, and
does the change make scientific sense?**

The distinction that matters most
─────────────────────────────────
A revision that shifts a position *within* the combined uncertainties is a
refinement — normal, expected, uninteresting. A revision that shifts it far
*outside* them is not a refinement at all: either the earlier notice was wrong,
the two notices describe different sources, or a coordinate convention was
mishandled. Reporting both as "position updated" hides a real failure behind a
routine label, so they are separated here and the second is an ERROR.

Comparability rules
───────────────────
Two numbers can only be compared when they mean the same thing:

  * Localization radii are compared only when both notices state the SAME
    containment convention. A source switching from a 1-sigma radius to a 90%
    containment radius would otherwise look like a 2.15x degradation, and the
    reverse would look like a 56% improvement — both entirely artefacts of the
    convention (spec section 23).

  * A value that disappears between revisions is NOT an improvement and NOT a
    zero. It is a loss of information, reported as such.

Nothing here mutates either revision, and nothing here rejects a notice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field as dc_field
from typing import Any

from app.science.diagnostics import Level

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

#: A position shift beyond this multiple of the combined 1-sigma-equivalent
#: uncertainty is treated as inconsistent rather than refined. 3 sigma is the
#: conventional discrepancy threshold and is deliberately generous: a false
#: "inconsistent" verdict is worse than a missed one.
POSITION_INCONSISTENT_SIGMA = 3.0

#: When no uncertainty is available on either notice, a shift beyond this many
#: degrees is still worth reporting — it is far larger than any instrument's
#: refinement of its own position.
POSITION_LARGE_SHIFT_DEG = 1.0

#: Fractional change in a localization radius worth reporting at all.
LOCALIZATION_MIN_CHANGE = 0.10

#: A FAR changing by more than this factor is a significance change, not noise.
FAR_SIGNIFICANT_FACTOR = 10.0

#: Fields whose disappearance between revisions is scientifically material.
TRACKED_MEASUREMENTS = (
    "ra", "dec", "errorRadius", "snr", "far", "signalness",
    "fluence", "t90", "dm", "chirpMass", "luminosityDistance", "redshift",
    "area50Deg2", "area90Deg2", "epeak",
)

#: Fields describing what the event *is*, rather than how well it is measured.
CLASSIFICATION_FIELDS = ("eventType", "classificationTier", "lifecycle")


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


def angular_separation_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """
    Great-circle separation via the haversine formula.

    Haversine rather than the spherical law of cosines because revisions are
    usually *small* shifts, and the cosine formula loses precision badly at
    small angles — exactly where the refinement-vs-inconsistency judgement is
    made.
    """
    p1, p2 = math.radians(dec1), math.radians(dec2)
    dp = p2 - p1
    dl = math.radians(ra2 - ra1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a))))


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Delta:
    """One scientific change between two notices."""

    level: Level
    code: str
    field: str | None
    message: str
    previous: Any = None
    current: Any = None
    #: Machine-readable magnitude of the change, where one is meaningful.
    magnitude: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "level": self.level.label,
            "code": self.code,
            "field": self.field,
            "message": self.message,
            "previous": self.previous,
            "current": self.current,
            "magnitude": self.magnitude,
        }


@dataclass
class RevisionReport:
    """Every scientific change carried by one new notice."""

    deltas: list[Delta] = dc_field(default_factory=list)

    def add(self, level: Level, code: str, message: str, field: str | None = None,
            previous: Any = None, current: Any = None,
            magnitude: float | None = None) -> None:
        self.deltas.append(Delta(level, code, field, message, previous, current, magnitude))

    @property
    def worst(self) -> Level | None:
        return max((d.level for d in self.deltas), default=None)

    @property
    def significance(self) -> str:
        """
        NONE | ROUTINE | NOTABLE | CRITICAL — the headline verdict.

        Deliberately distinct from validation's PASS/WARNING/FAIL: a revision
        can be scientifically dramatic while both notices are perfectly valid.
        """
        w = self.worst
        if w is None:
            return "NONE"
        if w >= Level.ERROR:
            return "CRITICAL"
        if w == Level.WARNING:
            return "NOTABLE"
        return "ROUTINE"

    def has(self, code: str) -> bool:
        return any(d.code == code for d in self.deltas)

    def codes(self) -> list[str]:
        return [d.code for d in self.deltas]

    def to_dict(self) -> dict[str, Any]:
        return {
            "significance": self.significance,
            "worstLevel": self.worst.label if self.worst else None,
            "changeCount": len(self.deltas),
            "deltas": [d.to_dict() for d in self.deltas],
        }


# ---------------------------------------------------------------------------
# Individual comparisons
# ---------------------------------------------------------------------------

def _sigma_equivalent_deg(ev: dict[str, Any]) -> float | None:
    """
    The event's positional uncertainty as a 1-sigma-equivalent radius in
    degrees, or None when it cannot be established.

    Converting a stated containment radius down to 1 sigma requires knowing
    what it contains. Where the convention is unstated the radius is used
    as-is and the caller weakens its conclusion accordingly — it is not
    silently assumed to be 1 sigma.
    """
    from app.science.uncertainty import CONTAINMENT_CONVENTIONS, containment_scale

    r_arcmin = _num(ev.get("errorRadius"))
    if r_arcmin is None or r_arcmin <= 0:
        return None
    r_deg = r_arcmin / 60.0

    conv = ev.get("errorRadiusContainment")
    spec = CONTAINMENT_CONVENTIONS.get(str(conv)) if conv else None
    if spec is None:
        return r_deg                      # used as-is; caveat added by caller
    scale = containment_scale(spec["fraction"], spec["dim"])
    return r_deg / scale if scale else r_deg


def check_retraction(prev: dict, curr: dict, rep: RevisionReport) -> None:
    """A retraction invalidates everything downstream and outranks all else."""
    was = bool(prev.get("isRetraction"))
    now = bool(curr.get("isRetraction"))
    if now and not was:
        rep.add(Level.CRITICAL, "revision_retracted",
                "This notice RETRACTS the event. Every measurement and every "
                "quantity derived from it — including any correlation that used "
                "it — must be treated as withdrawn.",
                "isRetraction", was, now)
    elif was and not now:
        rep.add(Level.ERROR, "revision_unretracted",
                "A previously retracted event is no longer marked as retracted. "
                "This is unusual and should be confirmed against the source "
                "circulars before the event is used.",
                "isRetraction", was, now)


def check_position(prev: dict, curr: dict, rep: RevisionReport) -> None:
    """
    The central check: did the position move further than its own error bars
    can explain?
    """
    ra0, dec0 = _num(prev.get("ra")), _num(prev.get("dec"))
    ra1, dec1 = _num(curr.get("ra")), _num(curr.get("dec"))

    had, has = (ra0 is not None and dec0 is not None), (ra1 is not None and dec1 is not None)

    if had and not has:
        rep.add(Level.WARNING, "revision_position_lost",
                "The revised notice reports no sky position although the previous "
                "one did. This is a loss of information, not a refinement.",
                "ra", [ra0, dec0], None)
        return
    if has and not had:
        rep.add(Level.NOTICE, "revision_position_gained",
                "A sky position is reported for the first time in this revision.",
                "ra", None, [ra1, dec1])
        return
    if not (had and has):
        return

    sep = angular_separation_deg(ra0, dec0, ra1, dec1)
    if sep == 0.0:
        return

    s0, s1 = _sigma_equivalent_deg(prev), _sigma_equivalent_deg(curr)
    conventions_stated = bool(prev.get("errorRadiusContainment")) and \
        bool(curr.get("errorRadiusContainment"))

    if s0 is not None or s1 is not None:
        combined = math.hypot(s0 or 0.0, s1 or 0.0)
        n_sigma = sep / combined if combined > 0 else float("inf")

        if n_sigma > POSITION_INCONSISTENT_SIGMA:
            caveat = "" if conventions_stated else (
                " The containment conventions were not stated by the source, so "
                "the uncertainties were used as reported; the significance is "
                "indicative rather than exact."
            )
            rep.add(Level.ERROR, "revision_position_inconsistent",
                    f"The position moved {sep:.4f} deg, which is {n_sigma:.1f}x the "
                    f"combined localization uncertainty ({combined:.4f} deg). This "
                    "is not a refinement: the notices are mutually inconsistent, "
                    "and either the earlier position was wrong or they describe "
                    f"different sources.{caveat}",
                    "ra", [ra0, dec0], [ra1, dec1], round(n_sigma, 3))
        else:
            rep.add(Level.INFO, "revision_position_refined",
                    f"The position moved {sep:.4f} deg, within the combined "
                    f"localization uncertainty ({n_sigma:.1f} sigma). This is a "
                    "normal refinement.",
                    "ra", [ra0, dec0], [ra1, dec1], round(n_sigma, 3))
        return

    # No uncertainty on either notice: the shift can only be judged by size.
    level = Level.WARNING if sep > POSITION_LARGE_SHIFT_DEG else Level.INFO
    rep.add(level, "revision_position_moved",
            f"The position moved {sep:.4f} deg. Neither notice reports a "
            "localization uncertainty, so whether this is a refinement or an "
            "inconsistency cannot be determined.",
            "ra", [ra0, dec0], [ra1, dec1], round(sep, 5))


def check_localization(prev: dict, curr: dict, rep: RevisionReport) -> None:
    """
    Compare localization quality — but only where the two numbers mean the
    same thing.
    """
    r0, r1 = _num(prev.get("errorRadius")), _num(curr.get("errorRadius"))
    c0, c1 = prev.get("errorRadiusContainment"), curr.get("errorRadiusContainment")

    if r0 is not None and r1 is None:
        rep.add(Level.WARNING, "revision_localization_lost",
                "The revised notice reports no localization uncertainty although "
                "the previous one did. An absent uncertainty is UNKNOWN — it is "
                "not a perfect localization and not an improvement.",
                "errorRadius", r0, None)
        return
    if r0 is None and r1 is not None:
        rep.add(Level.NOTICE, "revision_localization_gained",
                f"A localization uncertainty ({r1:.3f} arcmin) is reported for the "
                "first time in this revision.", "errorRadius", None, r1)
        return
    if r0 is None or r1 is None or r0 <= 0 or r1 <= 0:
        return

    if c0 != c1:
        # The comparison is refused rather than performed wrongly.
        rep.add(Level.WARNING, "revision_containment_changed",
                f"The localization containment convention changed "
                f"({c0 or 'unstated'} -> {c1 or 'unstated'}), so the two radii "
                f"({r0:.3f} -> {r1:.3f} arcmin) are not directly comparable. No "
                "improvement factor is reported, because most of any apparent "
                "change would be the convention rather than the measurement.",
                "errorRadiusContainment", c0, c1)
        return

    ratio = r1 / r0
    if abs(ratio - 1.0) < LOCALIZATION_MIN_CHANGE:
        return
    if ratio < 1.0:
        rep.add(Level.INFO, "revision_localization_improved",
                f"The localization tightened from {r0:.3f} to {r1:.3f} arcmin "
                f"({(1 - ratio) * 100:.1f}% smaller), both quoted as "
                f"{c0 or 'the same unstated convention'}.",
                "errorRadius", r0, r1, round(ratio, 4))
    else:
        rep.add(Level.NOTICE, "revision_localization_degraded",
                f"The localization widened from {r0:.3f} to {r1:.3f} arcmin "
                f"({(ratio - 1) * 100:.1f}% larger). A follow-up planned on the "
                "earlier region may no longer cover the source.",
                "errorRadius", r0, r1, round(ratio, 4))


def check_classification(prev: dict, curr: dict, rep: RevisionReport) -> None:
    """A change in what the event *is* outranks any change in how well it is measured."""
    for fld in CLASSIFICATION_FIELDS:
        a, b = prev.get(fld), curr.get(fld)
        if a == b or a is None or b is None:
            continue
        if fld == "eventType":
            rep.add(Level.ERROR, "revision_event_type_changed",
                    f"The messenger type changed from {a} to {b}. This is not a "
                    "refinement of one event; verify the notices refer to the "
                    "same object before merging them.", fld, a, b)
        elif fld == "lifecycle":
            rep.add(Level.INFO, "revision_lifecycle_advanced",
                    f"Lifecycle advanced from {a} to {b}.", fld, a, b)
        else:
            rep.add(Level.NOTICE, "revision_classification_changed",
                    f"{fld} changed from {a} to {b}.", fld, a, b)


def check_significance(prev: dict, curr: dict, rep: RevisionReport) -> None:
    """FAR and SNR changes large enough to change how the event is treated."""
    f0, f1 = _num(prev.get("far")), _num(curr.get("far"))
    if f0 is not None and f1 is not None and f0 > 0 and f1 > 0:
        factor = f1 / f0
        if factor >= FAR_SIGNIFICANT_FACTOR:
            rep.add(Level.WARNING, "revision_far_worsened",
                    f"The false alarm rate rose by a factor of {factor:.1f} "
                    f"({f0:.3e} -> {f1:.3e} Hz). The event is substantially less "
                    "significant than the previous notice indicated.",
                    "far", f0, f1, round(factor, 3))
        elif factor <= 1.0 / FAR_SIGNIFICANT_FACTOR:
            rep.add(Level.NOTICE, "revision_far_improved",
                    f"The false alarm rate fell by a factor of {1 / factor:.1f} "
                    f"({f0:.3e} -> {f1:.3e} Hz); the event is more significant "
                    "than previously reported.", "far", f0, f1, round(factor, 3))

    s0, s1 = _num(prev.get("snr")), _num(curr.get("snr"))
    if s0 is not None and s1 is not None and s0 > 0 and s1 > 0:
        if abs(s1 - s0) / s0 >= 0.5:
            rep.add(Level.NOTICE, "revision_snr_changed",
                    f"SNR changed substantially from {s0:.2f} to {s1:.2f}.",
                    "snr", s0, s1, round(s1 / s0, 3))


def check_lost_measurements(prev: dict, curr: dict, rep: RevisionReport) -> None:
    """
    Report every measurement the revision dropped.

    The UPSERT overwrites with whatever the new notice carries, so a quantity
    present in revision 1 and absent in revision 2 silently vanishes from the
    record. That is a change in what is known and must be visible — the
    remaining value is UNKNOWN, not unchanged and not zero.
    """
    # Position and localization have their own, more informative checks.
    skip = {"ra", "dec", "errorRadius"}
    lost = [f for f in TRACKED_MEASUREMENTS
            if f not in skip
            and _num(prev.get(f)) is not None
            and _num(curr.get(f)) is None]
    if lost:
        rep.add(Level.WARNING, "revision_measurements_lost",
                f"The revised notice no longer reports: {', '.join(lost)}. These "
                "become UNKNOWN rather than retaining their previous values.",
                lost[0], lost, None)

    gained = [f for f in TRACKED_MEASUREMENTS
              if f not in skip
              and _num(prev.get(f)) is None
              and _num(curr.get(f)) is not None]
    if gained:
        rep.add(Level.INFO, "revision_measurements_gained",
                f"The revised notice adds: {', '.join(gained)}.",
                gained[0], None, gained)


CHECKS = (
    check_retraction,
    check_position,
    check_localization,
    check_classification,
    check_significance,
    check_lost_measurements,
)


def compare_revisions(previous: dict[str, Any], current: dict[str, Any]) -> RevisionReport:
    """
    Every scientific change between two notices for the same event.

    Each check is isolated, on the same principle as validation: one failing
    comparison must not suppress the others or break ingestion (spec 48).
    """
    rep = RevisionReport()
    for check in CHECKS:
        try:
            check(previous, current, rep)
        except Exception as exc:  # pragma: no cover - defensive
            rep.add(Level.CRITICAL, "revision_check_failed",
                    f"Revision check {check.__name__} raised "
                    f"{type(exc).__name__}: {exc}")
    return rep


def snapshot(ev: dict[str, Any]) -> dict[str, Any]:
    """
    The scientific state worth preserving from one notice.

    Kept deliberately narrow: this is an append-only history, so it stores what
    is needed to reconstruct and compare revisions, not the whole payload.
    """
    keys = TRACKED_MEASUREMENTS + CLASSIFICATION_FIELDS + (
        "errorRadiusContainment", "detectionTime", "alertType",
        "isRetraction", "observatory", "validationStatus", "qualityScore",
    )
    return {k: ev.get(k) for k in keys if ev.get(k) is not None}


__all__ = [
    "Delta", "RevisionReport", "compare_revisions", "snapshot",
    "angular_separation_deg", "CHECKS",
    "POSITION_INCONSISTENT_SIGMA", "POSITION_LARGE_SHIFT_DEG",
    "FAR_SIGNIFICANT_FACTOR", "TRACKED_MEASUREMENTS",
]
