"""
validators.py
-------------
Universal scientific validation for a normalized AstroEvent
(spec sections 6-8, 25-28).

Design rules
────────────
  * Validation NEVER mutates the event and NEVER rejects it. It only produces
    diagnostics. Rejection is the Node-side alertFilter's job.
  * A missing value is not automatically an ERROR. Absence is honest; the
    pipeline is built so UNKNOWN is representable. Missing values are WARNINGs
    (or INFO where the quantity is not expected for that messenger).
  * Anything physically impossible is an ERROR, because a value outside the
    laws of the domain means the upstream parse or unit handling is broken.
  * Checks are deliberately conservative: they must not fire on legitimate
    astrophysics. A false ERROR is worse than a missed WARNING, because it
    trains researchers to ignore the panel.

Every check is a small named function so it can be unit-tested in isolation
and so the quality score can reference rules by name.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from app.science.diagnostics import Level, ValidationReport

# ---------------------------------------------------------------------------
# Bounds
# ---------------------------------------------------------------------------

RA_MIN, RA_MAX = 0.0, 360.0          # RA_MAX exclusive
DEC_MIN, DEC_MAX = -90.0, 90.0
SEPARATION_MAX = 180.0               # angular separation on a sphere

#: Sun separations below this mean the field is unobservable optically.
SUN_CONSTRAINT_DEG = 30.0

#: Detection times further in the future than this are impossible, allowing a
#: little slack for clock skew between the observatory and this host.
FUTURE_TOLERANCE = timedelta(minutes=5)

#: Older than this and the "detection" is almost certainly a parse error
#: (e.g. a default epoch) rather than a real historical alert.
ANCIENT_CUTOFF = datetime(1990, 1, 1, tzinfo=timezone.utc)

#: Localization radii larger than this (arcmin) are suspicious for a pointed
#: instrument, though GW skymaps legitimately exceed it.
LARGE_ERROR_RADIUS_ARCMIN = 60.0 * 30.0   # 30 degrees

#: Messengers for which an SNR is normally reported.
SNR_EXPECTED = {"GRB", "GW", "FRB"}


def _num(v: Any) -> float | None:
    """Return v as a finite float, or None."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


def _parse_time(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Coordinates (spec section 6)
# ---------------------------------------------------------------------------

def check_coordinates(ev: dict[str, Any], rep: ValidationReport) -> None:
    ra_raw, dec_raw = ev.get("ra"), ev.get("dec")
    ra, dec = _num(ra_raw), _num(dec_raw)

    # Present-but-unparseable is a different failure from absent.
    if ra_raw is not None and ra is None:
        rep.error("ra_not_numeric", "Right Ascension is present but not a finite number.", "ra", ra_raw)
    if dec_raw is not None and dec is None:
        rep.error("dec_not_numeric", "Declination is present but not a finite number.", "dec", dec_raw)

    if ra is None and dec is None and ra_raw is None and dec_raw is None:
        rep.warning("position_missing", "No sky position reported; the event cannot be localized.", "ra")
        return

    if (ra is None) != (dec is None):
        rep.error(
            "position_half_missing",
            "Only one of RA/Dec is present. A partial coordinate is unusable.",
            "ra" if ra is None else "dec",
        )

    if ra is not None and not (RA_MIN <= ra < RA_MAX):
        rep.error("ra_out_of_range", f"RA {ra} is outside [0, 360).", "ra", ra)
    if dec is not None and not (DEC_MIN <= dec <= DEC_MAX):
        rep.error("dec_out_of_range", f"Declination {dec} is outside [-90, +90].", "dec", dec)

    # The historical null-island signature. Legitimate but overwhelmingly
    # likely to be a placeholder, so flag it rather than trust it.
    if ra == 0.0 and dec == 0.0:
        rep.warning(
            "position_at_origin",
            "Position is exactly (0, 0). This is a valid coordinate but is the "
            "classic placeholder for a missing position — verify against the notice.",
            "ra", 0.0,
        )


def check_galactic(ev: dict[str, Any], rep: ValidationReport) -> None:
    l, b = _num(ev.get("galLon")), _num(ev.get("galLat"))
    if l is not None and not (0.0 <= l < 360.0):
        rep.error("gal_lon_out_of_range", f"Galactic longitude {l} outside [0, 360).", "galLon", l)
    if b is not None and not (-90.0 <= b <= 90.0):
        rep.error("gal_lat_out_of_range", f"Galactic latitude {b} outside [-90, +90].", "galLat", b)

    # Derived-without-input is the specific corruption Phase 1/2 removed.
    has_pos = _num(ev.get("ra")) is not None and _num(ev.get("dec")) is not None
    if not has_pos and (l is not None or b is not None):
        rep.error(
            "derived_without_position",
            "Galactic coordinates are present although the event has no sky "
            "position. A derived value cannot exist without its inputs.",
            "galLon",
        )


def check_separations(ev: dict[str, Any], rep: ValidationReport) -> None:
    has_pos = _num(ev.get("ra")) is not None and _num(ev.get("dec")) is not None
    for fld, body in (("sunDistance", "Sun"), ("moonDistance", "Moon")):
        sep = _num(ev.get(fld))
        if sep is None:
            continue
        if not (0.0 <= sep <= SEPARATION_MAX):
            rep.error(
                f"{fld}_out_of_range",
                f"{body} separation {sep} deg is outside [0, 180].", fld, sep,
            )
        if not has_pos:
            rep.error(
                "derived_without_position",
                f"{body} separation is present although the event has no sky position.",
                fld, sep,
            )

    sun = _num(ev.get("sunDistance"))
    if sun is not None and 0.0 <= sun < SUN_CONSTRAINT_DEG:
        rep.notice(
            "sun_constraint",
            f"Field is {sun:.1f} deg from the Sun; optical follow-up is not "
            f"feasible (< {SUN_CONSTRAINT_DEG:.0f} deg).",
            "sunDistance", sun,
        )


# ---------------------------------------------------------------------------
# Time (spec section 7)
# ---------------------------------------------------------------------------

def check_time(ev: dict[str, Any], rep: ValidationReport, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    raw = ev.get("detectionTime")
    dt = _parse_time(raw)

    if dt is None:
        rep.error("detection_time_unparseable",
                  "Detection time is missing or not a valid ISO-8601 timestamp.",
                  "detectionTime", raw)
        return

    if dt > now + FUTURE_TOLERANCE:
        rep.error(
            "detection_time_future",
            f"Detection time {dt.isoformat()} is in the future.",
            "detectionTime", dt.isoformat(),
        )
    if dt < ANCIENT_CUTOFF:
        rep.error(
            "detection_time_ancient",
            f"Detection time {dt.isoformat()} predates {ANCIENT_CUTOFF.year}; "
            "this is almost certainly a parse error, not a real detection.",
            "detectionTime", dt.isoformat(),
        )

    latency = ev.get("latencyUs")
    lat = _num(latency)
    if lat is not None and lat < 0:
        rep.error("latency_negative",
                  "Ingestion latency is negative, implying the event was received "
                  "before it occurred.", "latencyUs", lat)


# ---------------------------------------------------------------------------
# Physical sanity of measurements (spec section 25)
# ---------------------------------------------------------------------------

def check_measurements(ev: dict[str, Any], rep: ValidationReport) -> None:
    etype = str(ev.get("eventType") or "").upper()

    snr = _num(ev.get("snr"))
    if snr is None:
        if etype in SNR_EXPECTED:
            rep.warning("snr_missing",
                        f"No signal-to-noise ratio reported for this {etype}.", "snr")
        else:
            rep.info("snr_not_applicable",
                     f"No SNR reported; not normally provided for {etype or 'this messenger'}.", "snr")
    elif snr <= 0:
        rep.error("snr_non_positive",
                  f"SNR {snr} is not positive; a detection significance must exceed zero.",
                  "snr", snr)

    far = _num(ev.get("far"))
    if far is None:
        rep.warning("far_missing",
                    "No false alarm rate reported; statistical significance cannot be assessed.",
                    "far")
    elif far <= 0:
        rep.error("far_non_positive",
                  f"FAR {far} Hz is not positive; a rate of zero would mean no false alarms ever.",
                  "far", far)

    err = _num(ev.get("errorRadius"))
    if err is None:
        rep.warning("error_radius_missing",
                    "No localization uncertainty reported; the position cannot be "
                    "used for follow-up planning without it.", "errorRadius")
    elif err <= 0:
        rep.error("error_radius_non_positive",
                  f"Localization radius {err} is not positive; a perfectly known "
                  "position is not physical.", "errorRadius", err)
    elif err > LARGE_ERROR_RADIUS_ARCMIN:
        rep.notice("error_radius_large",
                   f"Localization radius {err/60:.1f} deg is very large; "
                   "follow-up will require wide-field tiling.", "errorRadius", err)

    for fld, unit in (("fluence", "erg/cm2"), ("peakFlux", ""), ("t90", "s"),
                      ("dm", "pc/cm3"), ("chirpMass", "Msun"),
                      ("luminosityDistance", "Mpc")):
        v = _num(ev.get(fld))
        if v is not None and v < 0:
            rep.error(f"{fld}_negative",
                      f"{fld} is negative ({v} {unit}), which is unphysical.", fld, v)

    sig = _num(ev.get("signalness"))
    if sig is not None and not (0.0 <= sig <= 1.0):
        rep.error("signalness_out_of_range",
                  f"Signalness {sig} is outside [0, 1]; it is a probability.",
                  "signalness", sig)


# ---------------------------------------------------------------------------
# Cross-field consistency (spec section 26)
# ---------------------------------------------------------------------------

def check_cross_field(ev: dict[str, Any], rep: ValidationReport) -> None:
    etype = str(ev.get("eventType") or "").upper()

    # Messenger-specific quantities appearing on the wrong messenger usually
    # means a parser wrote into the wrong field.
    if etype == "GRB":
        for fld in ("dm", "chirpMass"):
            if _num(ev.get(fld)) is not None:
                rep.warning("field_unexpected_for_type",
                            f"{fld} is reported for a GRB; this quantity belongs to "
                            f"{'FRBs' if fld == 'dm' else 'GW events'}.", fld, ev.get(fld))
    if etype == "FRB" and _num(ev.get("chirpMass")) is not None:
        rep.warning("field_unexpected_for_type",
                    "chirpMass is reported for an FRB; it is a gravitational-wave quantity.",
                    "chirpMass", ev.get("chirpMass"))
    if etype == "GW":
        for fld in ("dm", "fluence", "t90"):
            if _num(ev.get(fld)) is not None:
                rep.warning("field_unexpected_for_type",
                            f"{fld} is reported for a GW event; it is an "
                            "electromagnetic/radio quantity.", fld, ev.get(fld))

    # Signalness is an IceCube concept.
    if _num(ev.get("signalness")) is not None and etype not in {"NU", "OTHER", ""}:
        rep.notice("signalness_unexpected_for_type",
                   f"Signalness is reported for a {etype}; it is normally an "
                   "IceCube neutrino quantity.", "signalness", ev.get("signalness"))

    # A GRB whose T90 exceeds its own reported duration window, etc. Only
    # check relationships we can state without assuming a spectral model.
    t90 = _num(ev.get("t90"))
    if t90 is not None and t90 <= 0:
        rep.error("t90_non_positive",
                  f"T90 {t90} s is not positive; a burst duration must exceed zero.",
                  "t90", t90)

    # Fluence without an energy band cannot be compared across instruments.
    if _num(ev.get("fluence")) is not None and not ev.get("fluenceBand"):
        rep.notice("fluence_band_missing",
                   "Fluence is reported without an energy band; it is not "
                   "comparable across instruments without one.", "fluence")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

#: Raw-payload keys that map onto a normalized measurement, with whether zero
#: is physically permitted for that quantity.
RAW_MEASUREMENT_KEYS: dict[str, tuple[str, bool]] = {
    # raw key            -> (normalized field, zero_allowed)
    "snr":               ("snr", False),
    "image_snr":         ("snr", False),
    "far":               ("far", False),
    "loc_error":         ("errorRadius", False),
    "err_rad":           ("errorRadius", False),
    "error_radius":      ("errorRadius", False),
    "ra_err":            ("errorRadius", False),
    "dec_err":           ("errorRadius", False),
    "dm":                ("dm", True),
    "fluence":           ("fluence", True),
    "t90":               ("t90", False),
    "signalness":        ("signalness", True),
}


def check_source_sanitization(ev: dict[str, Any], rep: ValidationReport) -> None:
    """
    Flag measurements the normalizer had to discard.

    The normalizer deliberately converts impossible values to None so they are
    never persisted. That is right for storage but loses information for the
    researcher: a notice reporting SNR = -5 is a *broken notice*, which is a
    materially different situation from a notice that simply omitted SNR.

    Without this check the two are indistinguishable downstream — both look
    like "missing". Here the original payload is re-inspected so a discarded
    impossible value is reported as an ERROR against the source, not silently
    laundered into an absence.
    """
    raw = ev.get("raw")
    if not isinstance(raw, dict):
        return

    for key, (field, zero_ok) in RAW_MEASUREMENT_KEYS.items():
        if key not in raw:
            continue
        original = raw.get(key)
        if original is None:
            continue

        v = _num(original)
        if v is None:
            # Present in the notice but not a usable number at all.
            if not isinstance(original, (dict, list)):
                rep.error(
                    "source_value_unparseable",
                    f"Source field '{key}' is present but not a finite number "
                    f"({original!r}); it was discarded rather than stored.",
                    field, original,
                )
            continue

        impossible = v < 0 or (v == 0 and not zero_ok)
        if impossible and ev.get(field) is None:
            rep.error(
                "source_value_impossible",
                f"Source field '{key}' reported {v}, which is not physically "
                f"valid for {field}. The value was discarded, so this event has "
                f"no {field} rather than an incorrect one — but the upstream "
                f"notice or parser should be investigated.",
                field, v,
            )


# ---------------------------------------------------------------------------
# Units (spec section 34)
# ---------------------------------------------------------------------------

#: (value field, unit field, expected dimension). A stated unit is checked both
#: for resolvability and for belonging to the right dimension — a fluence
#: labelled "deg" is not a typo to be tolerated, it means two quantities have
#: been crossed somewhere upstream.
UNIT_PAIRS: tuple[tuple[str, str, str], ...] = (
    ("energy",             "energyUnit",             "ENERGY"),
    ("fluence",            "fluenceUnit",            "FLUENCE"),
    ("errorRadius",        "errorRadiusUnit",        "ANGLE"),
    ("luminosityDistance", "luminosityDistanceUnit", "DISTANCE"),
    ("t90",                "t90Unit",                "TIME"),
    ("dm",                 "dmUnit",                 "DISPERSION"),
)


def check_units(ev: dict[str, Any], rep: ValidationReport) -> None:
    """
    Verify every explicitly-stated unit resolves and has the expected dimension.

    A unit that cannot be resolved is an ERROR rather than a shrug: the value
    it labels is uninterpretable, and the alternative — assuming the unit this
    field "usually" has — is the failure mode that turns a TeV into a GeV.
    """
    from app.science.units import CANONICAL, dimension_of, resolve

    for value_field, unit_field, expected in UNIT_PAIRS:
        raw_unit = ev.get(unit_field)
        if raw_unit in (None, ""):
            continue
        if _num(ev.get(value_field)) is None:
            rep.notice(
                "unit_without_value",
                f"{unit_field} is set to '{raw_unit}' but {value_field} has no "
                "value; the unit describes nothing.", unit_field, raw_unit,
            )
            continue

        if resolve(raw_unit) is None:
            rep.error(
                "unit_unrecognised",
                f"Unit '{raw_unit}' on {value_field} is not recognised, so the "
                f"value cannot be converted or compared. It has NOT been assumed "
                f"to be {CANONICAL.get(expected, expected)}.",
                unit_field, raw_unit,
            )
            continue

        dim = dimension_of(raw_unit)
        if dim != expected:
            rep.error(
                "unit_wrong_dimension",
                f"{value_field} is labelled '{raw_unit}', which measures "
                f"{dim}, but this field is a {expected} quantity. Two different "
                "physical quantities have been crossed upstream.",
                unit_field, raw_unit,
            )


# ---------------------------------------------------------------------------
# Localization semantics (spec section 23)
# ---------------------------------------------------------------------------

#: A stated radius and an area-equivalent radius disagreeing by more than this
#: factor means they describe different things (typically 1-sigma vs 90%).
RADIUS_AREA_DISCREPANCY = 3.0


def check_localization_semantics(ev: dict[str, Any], rep: ValidationReport) -> None:
    """
    A localization radius is not a scientific quantity until its containment
    convention is known.

    "5 arcmin" could be a 1-sigma statistical error or a 90% containment
    radius; for a 2-D Gaussian those differ by a factor of 2.15. Downstream
    code that draws a circle, or ranks events by how well-localized they are,
    is comparing incomparable numbers whenever the convention is unstated.

    Unstated is a NOTICE, not a WARNING: essentially the whole alert ecosystem
    omits it, and a WARNING on every event would be noise that trains people to
    ignore the panel. A *contradictory* statement is an ERROR.
    """
    from app.science.uncertainty import (
        CONTAINMENT_CONVENTIONS,
        FULL_SKY_DEG2,
        area_to_radius_deg,
    )

    radius = _num(ev.get("errorRadius"))
    convention = ev.get("errorRadiusContainment")

    if convention:
        if str(convention) not in CONTAINMENT_CONVENTIONS:
            rep.error(
                "containment_convention_unrecognised",
                f"Localization containment '{convention}' is not a recognised "
                f"convention ({', '.join(sorted(CONTAINMENT_CONVENTIONS))}). "
                "The radius cannot be interpreted.",
                "errorRadiusContainment", convention,
            )
    elif radius is not None and radius > 0:
        rep.notice(
            "containment_convention_unstated",
            f"Localization radius {radius:.2f} arcmin is reported without its "
            "containment convention. A 1-sigma radius and a 90% containment "
            "radius differ by a factor of 2.15 for a 2-D Gaussian, so this "
            "value is not comparable between instruments.",
            "errorRadius", radius,
        )

    # Credible areas must describe a real patch of sky.
    for fld in ("area50Deg2", "area90Deg2"):
        area = _num(ev.get(fld))
        if area is None:
            continue
        if area <= 0:
            rep.error(f"{fld}_non_positive",
                      f"{fld} {area} deg2 is not positive.", fld, area)
        elif area > FULL_SKY_DEG2:
            rep.error(
                "credible_area_exceeds_sky",
                f"{fld} = {area:.1f} deg2 exceeds the whole sky "
                f"({FULL_SKY_DEG2:.0f} deg2).", fld, area,
            )

    # A radius and an area that disagree wildly are not the same quantity.
    area90 = _num(ev.get("area90Deg2"))
    if radius is not None and radius > 0 and area90 is not None and area90 > 0:
        equiv_deg = area_to_radius_deg(area90)
        radius_deg = radius / 60.0
        if equiv_deg and radius_deg > 0:
            ratio = max(equiv_deg / radius_deg, radius_deg / equiv_deg)
            if ratio > RADIUS_AREA_DISCREPANCY:
                rep.notice(
                    "radius_area_discrepant",
                    f"The reported radius ({radius_deg:.2f} deg) and the radius "
                    f"implied by the 90% area ({equiv_deg:.2f} deg) differ by a "
                    f"factor of {ratio:.1f}. They are describing different "
                    "confidence levels or different quantities.",
                    "errorRadius", round(ratio, 2),
                )


def check_messenger_specific(ev: dict[str, Any], rep: ValidationReport) -> None:
    """
    Dispatch to the validator for this event's messenger (spec sections 9-18).

    Imported lazily so the messengers package can import shared helpers from
    here without a circular import at module load.
    """
    from app.science.messengers import validate_for_type

    validate_for_type(ev, rep)


def check_observability(ev: dict[str, Any], rep: ValidationReport) -> None:
    """
    Report altitude and airmass **only** when a real observing site is
    configured (spec sections 21-22).

    When no site is set, nothing is emitted here: the absence is already
    explained in the derived block, and a diagnostic on every event would be
    noise rather than a finding. What is never done is compute an altitude
    from an invented location.
    """
    from app.science.observability import LOW_ALTITUDE_DEG, compute, load_site

    cfg = load_site()
    if not cfg.configured:
        return

    obs = compute(ev.get("ra"), ev.get("dec"), ev.get("detectionTime"), cfg)
    if not obs.available:
        return

    site = obs.site.name if obs.site else "the configured site"
    if not obs.above_horizon:
        rep.info(
            "target_below_horizon",
            f"At detection the target was {obs.altitude_deg:.1f} deg altitude "
            f"from {site} — below the horizon, so airmass is undefined.",
            "ra", obs.altitude_deg,
        )
    elif obs.altitude_deg is not None and obs.altitude_deg < LOW_ALTITUDE_DEG:
        rep.notice(
            "target_low_altitude",
            f"At detection the target was {obs.altitude_deg:.1f} deg altitude "
            f"from {site} (airmass {obs.airmass:.2f}); below "
            f"{LOW_ALTITUDE_DEG:.0f} deg, extinction and refraction make "
            "photometry unreliable.",
            "ra", obs.altitude_deg,
        )
    else:
        rep.info(
            "target_observable",
            f"At detection the target was {obs.altitude_deg:.1f} deg altitude "
            f"from {site} (airmass {obs.airmass:.2f}).",
            "ra", obs.altitude_deg,
        )


CHECKS = (
    check_coordinates,
    check_galactic,
    check_separations,
    check_time,
    check_measurements,
    check_cross_field,
    check_source_sanitization,
    check_units,
    check_localization_semantics,
    check_observability,
    check_messenger_specific,
)


def validate_event(ev: dict[str, Any], now: datetime | None = None) -> ValidationReport:
    """
    Run every universal check against a normalized event.

    Each check is isolated: a check that raises produces a CRITICAL diagnostic
    rather than aborting validation, so one bad rule can never suppress the
    findings of the others or break ingestion (spec section 48).
    """
    rep = ValidationReport()
    for check in CHECKS:
        try:
            if check is check_time:
                check(ev, rep, now)      # type: ignore[call-arg]
            else:
                check(ev, rep)
        except Exception as exc:  # pragma: no cover - defensive
            rep.critical(
                "validator_failed",
                f"Validator {check.__name__} raised {type(exc).__name__}: {exc}",
                None,
            )
    return rep
