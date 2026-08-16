"""
quality.py
----------
Scientific data-quality assessment (spec section 35).

The spec is explicit that this score must NOT be arbitrary: "Do not allow an
aesthetically pleasing score without scientific justification." So the score
here is fully determined by named, inspectable rules, and every assessment
returns the exact deductions that produced it.

Structure
─────────
Six independent components, each scored 0-100 from the diagnostics produced by
validators.py, then combined with fixed weights:

    source_integrity      15   identity fields needed to cite the event at all
    coordinate_validity   25   can it be pointed at?
    temporal_validity     15   can it be placed in time?
    physical_validity     25   are the numbers physically possible?
    completeness          10   are the expected measurements present?
    cross_field           10   are the fields mutually consistent?

Weights sum to 100. Coordinate and physical validity dominate because an event
that cannot be located, or that carries impossible numbers, is unusable for
follow-up regardless of how complete the rest is.

Deduction rules per component:
    an ERROR/CRITICAL diagnostic  -> component floored at 0
    a WARNING                     -> -35 each
    a NOTICE                      -> -5 each   (informational, small)
    INFO                          -> no deduction

Absence is penalised far more gently than impossibility. A missing FAR is a
gap in the notice; a negative FAR means the pipeline is broken.

This module makes no astrophysical judgement about whether an event is
*interesting* — only whether its data is trustworthy. Research interest is a
separate concept (spec section 44) and deliberately not conflated here.
"""

from __future__ import annotations

from typing import Any

from app.science.diagnostics import Diagnostic, Level, ValidationReport

# ---------------------------------------------------------------------------
# Component definitions
# ---------------------------------------------------------------------------

WEIGHTS: dict[str, int] = {
    "source_integrity": 15,
    "coordinate_validity": 25,
    "temporal_validity": 15,
    "physical_validity": 25,
    "completeness": 10,
    "cross_field": 10,
}

#: Which diagnostic codes count against which component. A code may appear in
#: exactly one component so deductions are never double-counted.
COMPONENT_CODES: dict[str, set[str]] = {
    "coordinate_validity": {
        # messenger-specific localization findings
        "gw_area90Deg2_non_positive", "gw_area50Deg2_non_positive",
        "gw_credible_area_inverted", "gw_radius_vs_credible_region",
        "nu_localization_coarse", "nu_cascade_localization_suspicious",
        # localization semantics (Phase 5, spec section 23)
        "containment_convention_unstated", "containment_convention_unrecognised",
        "credible_area_exceeds_sky", "radius_area_discrepant",
        "area50Deg2_non_positive", "area90Deg2_non_positive",
        # observability (Phase 5, spec sections 21-22) — a target below the
        # horizon or at high airmass is a pointing fact, not a data defect,
        # so only the low-altitude NOTICE carries a small deduction.
        "target_low_altitude",
        "ra_not_numeric", "dec_not_numeric", "position_missing",
        "position_half_missing", "ra_out_of_range", "dec_out_of_range",
        "position_at_origin", "gal_lon_out_of_range", "gal_lat_out_of_range",
        "sunDistance_out_of_range", "moonDistance_out_of_range",
        "derived_without_position", "error_radius_large", "sun_constraint",
    },
    "temporal_validity": {
        "detection_time_unparseable", "detection_time_future",
        "detection_time_ancient", "latency_negative",
    },
    "physical_validity": {
        # A value whose unit cannot be resolved, or whose unit measures the
        # wrong thing, is not a slightly-degraded number — it is an
        # uninterpretable one (Phase 5, spec section 34).
        "unit_unrecognised", "unit_wrong_dimension", "unit_without_value",
        "source_value_impossible", "source_value_unparseable",
        "snr_non_positive", "far_non_positive", "error_radius_non_positive",
        "signalness_out_of_range", "t90_non_positive",
        "fluence_negative", "peakFlux_negative", "t90_negative",
        "dm_negative", "chirpMass_negative", "luminosityDistance_negative",
    },
    "completeness": {
        # messenger-specific absences
        "grb_t90_missing", "grb_fluence_band_missing", "frb_dm_missing",
        "nu_signalness_missing", "gw_distance_no_uncertainty",
        "snr_missing", "far_missing", "error_radius_missing",
        "fluence_band_missing",
    },
    "cross_field": {
        # messenger-specific internal inconsistencies
        "gw_chirp_mass_inconsistent", "gw_hasns_inconsistent",
        "gw_partition_sum_invalid", "gw_partition_incomplete",
        "gw_mass_ordering", "gw_marginal_probability",
        "frb_dm_mw_exceeds_total", "frb_dm_excess_inconsistent",
        "nu_tier_signalness_mismatch", "nu_snr_reported",
        "field_unexpected_for_type", "signalness_unexpected_for_type",
    },
    "source_integrity": {
        "identity_missing", "validator_failed",
    },
}

DEDUCTION = {
    Level.INFO: 0,
    Level.NOTICE: 5,
    Level.WARNING: 35,
}

#: Diagnostics that floor their component even though they are only WARNINGs.
#: A missing position is not "somewhat degraded" — an event that cannot be
#: pointed at has zero coordinate validity, however well-formed the notice is.
FLOORING_CODES = {"position_missing", "position_half_missing"}

#: An event containing any ERROR/CRITICAL finding cannot score above this.
FAIL_SCORE_CAP = 40

IDENTITY_FIELDS = ("eventId", "eventType", "detectionTime", "observatory")

#: Numeric quantities whose presence makes physical/cross-field checks
#: meaningful. With none of them present there is nothing to validate, and a
#: component cannot earn full marks for the absence of evidence.
MEASURABLE_FIELDS = (
    "snr", "far", "errorRadius", "fluence", "peakFlux", "t90",
    "dm", "chirpMass", "luminosityDistance", "signalness",
)


def _has_any_measurement(ev: dict[str, Any]) -> bool:
    for f in MEASURABLE_FIELDS:
        v = ev.get(f)
        if v is None or isinstance(v, bool):
            continue
        try:
            float(v)
            return True
        except (TypeError, ValueError):
            continue
    return False


def _component_for(code: str) -> str:
    for comp, codes in COMPONENT_CODES.items():
        if code in codes:
            return comp
    # An unmapped code must still be visible rather than silently free.
    return "physical_validity"


def _grade(score: int) -> str:
    if score >= 90:
        return "PASS"
    if score >= 60:
        return "PARTIAL"
    if score > 0:
        return "POOR"
    return "FAIL"


def score_quality(ev: dict[str, Any], report: ValidationReport) -> dict[str, Any]:
    """
    Produce a transparent quality assessment.

    Returns a dict carrying the overall score, each component's score and
    grade, and the itemised deductions — so any number shown to a researcher
    can be traced to the rules that produced it.
    """
    # Identity check feeds source_integrity directly rather than via a
    # validator, because it concerns whether the record is citable at all.
    missing_identity = [f for f in IDENTITY_FIELDS if not ev.get(f)]
    extra: list[Diagnostic] = []
    if missing_identity:
        extra.append(
            Diagnostic(
                level=Level.ERROR,
                code="identity_missing",
                field=missing_identity[0],
                message=f"Missing identity field(s): {', '.join(missing_identity)}.",
                value=missing_identity,
            )
        )

    components: dict[str, dict[str, Any]] = {
        name: {"score": 100, "deductions": []} for name in WEIGHTS
    }

    for d in list(report.diagnostics) + extra:
        comp = _component_for(d.code)
        bucket = components[comp]
        if d.level >= Level.ERROR or d.code in FLOORING_CODES:
            bucket["deductions"].append(
                {"code": d.code, "level": d.level.label, "points": bucket["score"],
                 "reason": ("component floored — quantity is impossible or the "
                            "event is unusable for its purpose")}
            )
            bucket["score"] = 0
        else:
            points = DEDUCTION.get(d.level, 0)
            if points:
                applied = min(points, bucket["score"])
                bucket["score"] -= applied
                bucket["deductions"].append(
                    {"code": d.code, "level": d.level.label, "points": applied,
                     "reason": d.message}
                )

    # ── Applicability ───────────────────────────────────────────────────────
    # A component with nothing to assess must not score 100. "No impossible
    # values" is vacuously true when there are no values at all, and counting
    # that as a pass would let an empty event inherit a respectable score.
    # Such components are marked N/A and excluded, and the remaining weights
    # are renormalised so the total still reads out of 100.
    measurable = _has_any_measurement(ev)
    for name in ("physical_validity", "cross_field"):
        if not measurable:
            components[name]["applicable"] = False
            components[name]["score"] = None
            components[name]["grade"] = "N/A"
            components[name]["deductions"].append(
                {"code": "no_measurements", "level": "INFO", "points": 0,
                 "reason": "No measured quantities present — nothing to assess."}
            )

    total_weight = 0
    weighted = 0.0
    for name, weight in WEIGHTS.items():
        comp = components[name]
        comp["weight"] = weight
        comp.setdefault("applicable", True)
        if not comp["applicable"]:
            continue
        comp["grade"] = _grade(comp["score"])
        weighted += comp["score"] * weight
        total_weight += weight

    overall = int(round(weighted / total_weight)) if total_weight else 0

    # ── Hard gate on impossibility ──────────────────────────────────────────
    # An event carrying a physically impossible value cannot be graded above
    # FAIL, however healthy its other components are. Without this, five sound
    # components carry a broken record: an out-of-range declination scored 75
    # "PARTIAL" while the validation status already read FAIL — a headline
    # number contradicting its own verdict.
    capped = False
    if report.status == "FAIL":
        if overall > FAIL_SCORE_CAP:
            overall = FAIL_SCORE_CAP
            capped = True
        grade = "FAIL"
    elif report.status == "WARNING":
        # The headline grade must not read "PASS" while validation is raising
        # a warning — a researcher scanning grades would never open it.
        grade = _grade(overall)
        if grade == "PASS":
            grade = "PARTIAL"
    else:
        grade = _grade(overall)

    return {
        "overall": overall,
        "grade": grade,
        "scoreCapped": capped,
        "status": report.status,
        "components": components,
        "weights": dict(WEIGHTS),
        "effectiveWeight": total_weight,
        "rubric": {
            "ERROR_or_CRITICAL": "component floored to 0",
            "missing_position": "coordinate_validity floored to 0",
            "WARNING": f"-{DEDUCTION[Level.WARNING]} each",
            "NOTICE": f"-{DEDUCTION[Level.NOTICE]} each",
            "INFO": "no deduction",
            "no_evidence": "component marked N/A and excluded from the average",
            "any_ERROR": f"overall capped at {FAIL_SCORE_CAP} and graded FAIL",
        },
    }
