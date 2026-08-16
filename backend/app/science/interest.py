"""
interest.py
-----------
Research interest score (spec section 44).

What this is NOT
────────────────
There are now three scores in the pipeline and they answer three different
questions. Conflating them is the mistake this module is written to avoid:

    quality.py       Is the DATA trustworthy?          (Phase 3)
    priorityEngine   Should someone be emailed NOW?    (notification workstream)
    interest.py      Is this event scientifically worth studying?

They genuinely diverge. A well-measured, well-localized GRB — the three
thousandth of its kind — scores high on quality and low on interest. A nearby
binary-neutron-star merger with a poor skymap is only moderate quality and
enormous interest. Reporting one number for both would mislead in both
directions.

The honesty constraints
───────────────────────
  * **An unknown never adds interest.** Absence of a measurement is not
    evidence of anything. An event with no FAR is not "highly significant by
    default", and a missing localization does not make an event rare. Every
    rule contributes only from values that exist.

  * **A retraction zeroes the score.** A withdrawn event is not interesting; it
    is not an event.

  * **Every point is traceable.** The score is the sum of named rules, each
    returning its own contribution and the reason for it, so a researcher can
    see exactly why a number is what it is and disagree with a specific rule
    rather than with an opaque total.

  * **It is triage, not science.** "Interesting" is a judgement, not a
    measurement. This score is a queue-ordering aid built from stated
    astrophysical rationales; it is labelled as such and must never be
    presented as a property of the event.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

MAX_SCORE = 100

#: Multi-messenger events are the rarest and most scientifically valuable
#: class, so the messenger itself carries a baseline.
#: Rationale is recorded per entry because the ordering is a judgement.
MESSENGER_BASE: dict[str, tuple[int, str]] = {
    "GW":  (25, "Gravitational-wave detections remain rare and each one "
                "constrains compact-object populations."),
    "NU":  (25, "High-energy astrophysical neutrinos are rare and localise a "
                "hadronic accelerator."),
    "FRB": (15, "FRB progenitors are unresolved; every well-characterised "
                "burst is informative."),
    "GRB": (10, "GRBs are detected routinely; interest comes mainly from the "
                "individual event's properties."),
    "EP":  (10, "X-ray transients are detected routinely."),
}

#: A GW event with a real chance of an electromagnetic counterpart is the
#: highest-value case in the archive.
NS_PROBABILITY_FIELD = "HasNS"

#: Localization thresholds for follow-up feasibility, in square degrees.
#: Below the first, a single wide-field pointing covers the region.
AREA_EXCELLENT_DEG2 = 20.0
AREA_USABLE_DEG2 = 200.0

#: Localization radius thresholds in arcmin for non-GW messengers.
RADIUS_EXCELLENT_ARCMIN = 5.0
RADIUS_USABLE_ARCMIN = 60.0

#: A false alarm rate below this is exceptional for any survey.
FAR_EXCEPTIONAL_HZ = 1e-9
FAR_STRONG_HZ = 1e-7

#: Distance below which a compact-binary merger is exceptionally close and a
#: counterpart search is realistic.
NEARBY_MPC = 200.0

#: Neutrino signalness above which the event is very likely astrophysical.
SIGNALNESS_STRONG = 0.7


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


@dataclass(frozen=True)
class Contribution:
    """One named rule's contribution to the score."""

    rule: str
    points: int
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {"rule": self.rule, "points": self.points, "reason": self.reason}


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

def rule_messenger(ev: dict[str, Any]) -> Contribution | None:
    etype = str(ev.get("eventType") or "").upper()
    entry = MESSENGER_BASE.get(etype)
    if entry is None:
        return None
    points, reason = entry
    return Contribution("messenger_rarity", points, reason)


def rule_counterpart_potential(ev: dict[str, Any]) -> Contribution | None:
    """
    A GW event that may contain a neutron star can have an electromagnetic
    counterpart — the single most valuable follow-up case there is.
    """
    if str(ev.get("eventType") or "").upper() != "GW":
        return None
    p = _num(ev.get(NS_PROBABILITY_FIELD))
    if p is None or not (0.0 <= p <= 1.0):
        return None
    if p >= 0.5:
        return Contribution(
            "counterpart_potential", 20,
            f"HasNS = {p:.2f}: a neutron star is probably involved, so an "
            "electromagnetic counterpart (kilonova, short GRB) is plausible.")
    if p >= 0.1:
        return Contribution(
            "counterpart_potential", 8,
            f"HasNS = {p:.2f}: a counterpart is possible but not favoured.")
    return None


def rule_significance(ev: dict[str, Any]) -> Contribution | None:
    """
    Statistical significance, from FAR where reported.

    A missing FAR contributes nothing. It emphatically does not contribute the
    maximum: FAR = 0 would mean "no false alarms ever", and treating an absent
    value that way is how an unmeasured event becomes the most significant one
    in the archive.
    """
    far = _num(ev.get("far"))
    if far is None or far <= 0:
        return None
    if far <= FAR_EXCEPTIONAL_HZ:
        return Contribution(
            "significance", 20,
            f"FAR {far:.2e} Hz is below one false alarm per ~30 years; the "
            "detection is exceptionally significant.")
    if far <= FAR_STRONG_HZ:
        return Contribution(
            "significance", 10,
            f"FAR {far:.2e} Hz indicates a strong detection.")
    return Contribution(
        "significance", 0,
        f"FAR {far:.2e} Hz is high; the detection is marginal.")


def rule_neutrino_signalness(ev: dict[str, Any]) -> Contribution | None:
    if str(ev.get("eventType") or "").upper() != "NU":
        return None
    sig = _num(ev.get("signalness"))
    if sig is None or not (0.0 <= sig <= 1.0):
        return None
    if sig >= SIGNALNESS_STRONG:
        return Contribution(
            "signalness", 15,
            f"Signalness {sig:.2f}: very likely astrophysical rather than an "
            "atmospheric background event.")
    if sig >= 0.5:
        return Contribution("signalness", 7,
                            f"Signalness {sig:.2f}: more likely astrophysical than not.")
    return None


def rule_followup_feasibility(ev: dict[str, Any]) -> Contribution | None:
    """
    How practical a targeted follow-up is.

    A tight localization raises interest because the event can actually be
    studied. An absent localization contributes nothing — it is not a
    "perfect" one, the error the notification engine made in Phase 6.
    """
    area = _num(ev.get("area90Deg2"))
    if area is not None and area > 0:
        if area <= AREA_EXCELLENT_DEG2:
            return Contribution(
                "followup_feasibility", 15,
                f"90% credible area {area:.0f} deg2 is small enough for "
                "targeted wide-field follow-up.")
        if area <= AREA_USABLE_DEG2:
            return Contribution(
                "followup_feasibility", 7,
                f"90% credible area {area:.0f} deg2 is tileable by a wide-field "
                "survey.")
        return Contribution(
            "followup_feasibility", 0,
            f"90% credible area {area:.0f} deg2 is too large for practical "
            "targeted follow-up.")

    radius = _num(ev.get("errorRadius"))
    if radius is None or radius <= 0:
        return None
    if radius <= RADIUS_EXCELLENT_ARCMIN:
        return Contribution(
            "followup_feasibility", 15,
            f"Localization radius {radius:.1f} arcmin permits immediate "
            "single-pointing follow-up.")
    if radius <= RADIUS_USABLE_ARCMIN:
        return Contribution(
            "followup_feasibility", 7,
            f"Localization radius {radius:.1f} arcmin is workable for a "
            "wide-field instrument.")
    return Contribution(
        "followup_feasibility", 0,
        f"Localization radius {radius / 60:.1f} deg requires extensive tiling.")


def rule_proximity(ev: dict[str, Any]) -> Contribution | None:
    """A nearby source is brighter, better resolved, and more likely to yield
    a counterpart."""
    d = _num(ev.get("luminosityDistance"))
    if d is None or d <= 0:
        return None
    if d <= NEARBY_MPC:
        return Contribution(
            "proximity", 15,
            f"Luminosity distance {d:.0f} Mpc is exceptionally close; a "
            "counterpart search is realistic.")
    if d <= 1000.0:
        return Contribution("proximity", 6,
                            f"Luminosity distance {d:.0f} Mpc is within reach of "
                            "large optical facilities.")
    return None


def rule_extreme_properties(ev: dict[str, Any]) -> Contribution | None:
    """Values at the edge of the known population are worth a closer look."""
    reasons: list[str] = []
    points = 0

    t90 = _num(ev.get("t90"))
    if t90 is not None and 0 < t90 < 2.0:
        points += 8
        reasons.append(
            f"T90 = {t90:.2f} s falls in the short-duration class, which is "
            "statistically associated with compact-binary mergers (not a "
            "determination of progenitor)")

    dm = _num(ev.get("dm"))
    if dm is not None and dm > 1500.0:
        points += 8
        reasons.append(
            f"DM = {dm:.0f} pc/cm3 is unusually high, suggesting a large "
            "extragalactic path length")

    mc = _num(ev.get("chirpMass"))
    if mc is not None and 0 < mc < 2.0:
        points += 8
        reasons.append(
            f"Chirp mass {mc:.2f} Msun is in the binary-neutron-star range")

    if not points:
        return None
    return Contribution("extreme_properties", min(points, 16), "; ".join(reasons) + ".")


RULES = (
    rule_messenger,
    rule_counterpart_potential,
    rule_significance,
    rule_neutrino_signalness,
    rule_followup_feasibility,
    rule_proximity,
    rule_extreme_properties,
)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _band(score: int) -> str:
    if score >= 70:
        return "HIGH"
    if score >= 40:
        return "MODERATE"
    if score > 0:
        return "LOW"
    return "MINIMAL"


#: Returned when no rule could contribute anything at all — for example an
#: event type this module has no rules for.
#:
#: This is NOT the same as MINIMAL. "We looked and found little of interest"
#: and "we had nothing to look at" are different statements, and collapsing
#: them would rank an unassessed messenger below a genuinely dull one. Five
#: OTHER-type optical transients in the archive sat at score 0 and read as
#: uninteresting when in truth they had simply never been assessed.
UNASSESSED_BAND = "UNASSESSED"


def score_interest(ev: dict[str, Any]) -> dict[str, Any]:
    """
    A transparent research-interest assessment.

    Returns the total, the band, every rule's contribution, and the list of
    quantities that could not be assessed — so a low score is distinguishable
    from an unmeasured one. Those are very different situations: an event may
    be uninteresting, or it may simply be undescribed.
    """
    # A retraction ends the discussion.
    if ev.get("isRetraction"):
        return {
            "score": 0,
            "band": "MINIMAL",
            "contributions": [],
            "unassessed": [],
            "retracted": True,
            "note": "The event has been retracted and carries no research interest.",
            "disclaimer": DISCLAIMER,
        }

    contributions: list[Contribution] = []
    for rule in RULES:
        try:
            c = rule(ev)
        except Exception as exc:  # pragma: no cover - defensive
            contributions.append(
                Contribution(getattr(rule, "__name__", "rule"), 0,
                             f"Rule failed ({type(exc).__name__}: {exc}); it "
                             "contributed nothing rather than a guessed value."))
            continue
        if c is not None:
            contributions.append(c)

    total = min(MAX_SCORE, sum(c.points for c in contributions))

    # What could not be assessed, so a low score is not mistaken for a
    # confident verdict of "not interesting".
    unassessed: list[str] = []
    etype = str(ev.get("eventType") or "").upper()
    if etype not in MESSENGER_BASE:
        unassessed.append("eventType")
    if _num(ev.get("far")) is None:
        unassessed.append("far")
    if _num(ev.get("errorRadius")) is None and _num(ev.get("area90Deg2")) is None:
        unassessed.append("localization")
    if etype == "GW":
        if _num(ev.get("luminosityDistance")) is None:
            unassessed.append("luminosityDistance")
        if _num(ev.get(NS_PROBABILITY_FIELD)) is None:
            unassessed.append(NS_PROBABILITY_FIELD)
    if etype == "NU" and _num(ev.get("signalness")) is None:
        unassessed.append("signalness")

    # No rule contributed anything: the event was not assessed, which is not
    # the same as being uninteresting.
    if not any(c.points for c in contributions):
        return {
            "score": 0,
            "band": UNASSESSED_BAND,
            "contributions": [c.to_dict() for c in contributions],
            "unassessed": unassessed,
            "retracted": False,
            "maxScore": MAX_SCORE,
            "note": (
                f"No interest rule applies to this event. "
                f"{'Messenger type ' + repr(etype) + ' has no rules; ' if 'eventType' in unassessed else ''}"
                "the event has NOT been judged uninteresting — it has not been "
                "judged at all."
            ),
            "disclaimer": DISCLAIMER,
        }

    return {
        "score": total,
        "band": _band(total),
        "contributions": [c.to_dict() for c in contributions],
        "unassessed": unassessed,
        "retracted": False,
        "maxScore": MAX_SCORE,
        "note": (
            f"{len(unassessed)} quantity/quantities could not be assessed, so "
            "this score is a lower bound on what the event might merit."
            if unassessed else
            "All quantities relevant to this messenger were available."
        ),
        "disclaimer": DISCLAIMER,
    }


DISCLAIMER = (
    "Research interest is a triage heuristic for ordering a queue, not a "
    "measured property of the event. It is deliberately separate from the data "
    "quality score, which describes whether the measurements are trustworthy, "
    "and from notification priority, which describes urgency. Each rule's "
    "contribution and rationale is listed so it can be disagreed with "
    "individually."
)


__all__ = [
    "MAX_SCORE", "MESSENGER_BASE", "RULES", "DISCLAIMER",
    "Contribution", "score_interest",
]
