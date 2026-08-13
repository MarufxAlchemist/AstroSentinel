"""
normalizer.py
-------------
Translates raw GCN Kafka JSON payloads into the normalized AstroEvent
dict that the frontend expects.  Each instrument emits a different schema;
this module contains one parser per topic family.

All parsers return a dict that matches the camelCase AstroEvent TypeScript
type.  Fields that cannot be derived from a given payload are set to
sensible defaults so the frontend never crashes on a missing key.
"""

import math
import uuid
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Optional Astropy import — used for real Sun/Moon angular separation.
# Falls back gracefully if astropy is not installed.
# ---------------------------------------------------------------------------
try:
    from astropy.coordinates import GCRS, SkyCoord, get_body
    from astropy.time import Time
    import astropy.units as u
    # NOTE: NonRotationTransformationWarning is deliberately NOT suppressed.
    # It previously masked a real defect — see _sun_moon_distance(), where
    # separations were being taken between mismatched ICRS/GCRS origins and
    # were wrong by up to ~150°. If that warning starts firing again, a frame
    # mismatch has been reintroduced; fix the frames rather than silencing it.
    _ASTROPY_AVAILABLE = True
except ImportError:  # pragma: no cover
    _ASTROPY_AVAILABLE = False

from app.gcn.topics import get_topic_meta

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def normalize(topic: str, raw: dict[str, Any]) -> dict[str, Any]:
    """
    Return a camelCase AstroEvent-compatible dict from a raw GCN payload.
    Falls back to _generic() if no dedicated parser exists for the topic.
    """
    parsers = {
        "gcn.notices.chime.frb":                  _chime_frb,
        "gcn.notices.einstein_probe.wxt.alert":   _einstein_probe,
        "gcn.notices.icecube.lvk_nu_track_search":       _icecube,
        "gcn.notices.icecube.gold_bronze_track_alerts":  _icecube,
        "igwn.gwalert":                           _igwn,
        "gcn.notices.swift.bat.guano":            _swift_bat,
    }

    parser = parsers.get(topic, _generic)
    meta   = get_topic_meta(topic)

    base = {
        "id":           str(uuid.uuid4()),
        "eventType":    meta.event_type,
        "observatory":  meta.observatory,
        "topic":        topic,
        # Fields every parser must fill; defaults here protect against
        # a parser raising before it sets them.
        "eventId":      _make_event_id(meta.event_type),
        "detectionTime": _now_iso(),
        "ra":            0.0,
        "dec":           0.0,
        "errorRadius":   0.0,
        "snr":           0.0,
        "far":           0.0,
        "latencyUs":     0,
        "galLon":        0.0,
        "galLat":        0.0,
        "sunDistance":   0.0,
        "moonDistance":  0.0,
        "fluence":       None,
        "dm":            None,
        # FITS sky-localization URL — populated only for GW events (IGWN).
        # None means "no skymap URL present in this payload".
        "fitsUrl":       None,
        "raw":           raw,
    }

    try:
        parsed = parser(raw, meta.event_type)
        base.update(parsed)
    except Exception as exc:
        # Keep defaults; log but never crash the listener
        print(f"[normalizer] Failed to parse {topic}: {exc}")

    return base


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _make_event_id(event_type: str) -> str:
    """Synthetic ID used when the payload has no canonical name."""
    now = datetime.now(timezone.utc)
    return f"{event_type}{now.strftime('%Y%m%dT%H%M%S')}Z"


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _valid_radec(ra: Any, dec: Any) -> bool:
    """True only for finite coordinates inside physical ranges."""
    try:
        ra_f, dec_f = float(ra), float(dec)
    except (TypeError, ValueError):
        return False
    if math.isnan(ra_f) or math.isnan(dec_f):
        return False
    if math.isinf(ra_f) or math.isinf(dec_f):
        return False
    return 0.0 <= ra_f < 360.0 and -90.0 <= dec_f <= 90.0


def _ra_dec_to_gal(ra: float, dec: float) -> tuple[float | None, float | None]:
    """
    DERIVED: equatorial (ICRS) → Galactic coordinate transform via Astropy.

    Returns (None, None) — meaning UNKNOWN — if Astropy is unavailable or the
    input coordinates are not physically valid. Never returns a fabricated
    value: a wrong Galactic coordinate is worse than an absent one.

    Provenance: ICRS → Galactic, astropy.coordinates.SkyCoord.

    Parameters
    ----------
    ra, dec : float
        ICRS coordinates in decimal degrees.

    Returns
    -------
    (l, b) : tuple[float | None, float | None]
        Galactic longitude/latitude in degrees, or (None, None) if UNKNOWN.
    """
    if not _ASTROPY_AVAILABLE or not _valid_radec(ra, dec):
        return None, None
    try:
        gal = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs").galactic
        return round(float(gal.l.deg) % 360.0, 4), round(float(gal.b.deg), 4)
    except Exception as exc:  # pragma: no cover
        print(f"[normalizer] galactic transform failed (ra={ra}, dec={dec}): {exc}")
        return None, None


def _sun_moon_distance(
    ra: float,
    dec: float,
    detection_time_iso: str | None = None,
) -> tuple[float | None, float | None]:
    """
    DERIVED: angular separation (degrees) between the event sky position and
    the Sun / Moon at the moment of detection.

    Uses Astropy's built-in ephemeris via get_body().

    Returns (None, None) — meaning UNKNOWN — if:
      * Astropy is not installed
      * detection_time_iso is None or unparseable
      * the coordinates are not physically valid
      * the ephemeris calculation raises for any reason

    This function MUST NOT invent a separation. It previously returned
    90.0/90.0 on failure, which is indistinguishable from a genuine ~90°
    separation once persisted and silently corrupted the archive.

    Provenance: astropy.coordinates.get_body(), evaluated at the event's
    detection time in UTC.

    Parameters
    ----------
    ra : float
        Right Ascension in decimal degrees (ICRS / J2000).
    dec : float
        Declination in decimal degrees (ICRS / J2000).
    detection_time_iso : str | None
        ISO-8601 UTC timestamp of the event (e.g. "2026-06-07T12:34:56Z").

    Returns
    -------
    (sun_deg, moon_deg) : tuple[float | None, float | None]
        Angular separations in degrees rounded to 4 dp, or (None, None)
        if the quantity is UNKNOWN.
    """
    if not _ASTROPY_AVAILABLE or not detection_time_iso:
        return None, None
    if not _valid_radec(ra, dec):
        return None, None
    try:
        # Astropy Time(iso) requires the string without a tz offset.
        # Strip trailing Z or +00:00 and pass scale="utc" explicitly.
        ts = detection_time_iso.strip()
        if ts.endswith("Z"):
            ts = ts[:-1]
        elif ts.endswith("+00:00"):
            ts = ts[:-6]
        t = Time(ts, format="isot", scale="utc")
        event_coord = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")

        # get_body() returns a GEOCENTRIC (GCRS) position carrying a finite
        # distance (the Sun is ~1 AU away). Taking .separation() directly
        # between a distance-less ICRS (barycentric) coordinate and that GCRS
        # coordinate forces Astropy to reconcile two different origins, which
        # for a nearby solar-system body swings the apparent direction by up
        # to ~150° and yields a physically meaningless angle.
        #
        # The event position must be transformed into GCRS at the observation
        # epoch first, so both coordinates share an origin and epoch.
        #
        # This is what the previously-suppressed NonRotationTransformationWarning
        # was reporting. Do not silence that warning again.
        event_gcrs = event_coord.transform_to(GCRS(obstime=t))
        sun_sep  = round(float(event_gcrs.separation(get_body("sun",  t)).deg), 4)
        moon_sep = round(float(event_gcrs.separation(get_body("moon", t)).deg), 4)
        return sun_sep, moon_sep
    except Exception as exc:  # pragma: no cover
        print(f"[normalizer] sun/moon separation failed ({detection_time_iso}): {exc}")
        return None, None


def _latency_us(detection_time_iso: str) -> int:
    """Microseconds from detection_time to now."""
    try:
        dt = datetime.fromisoformat(detection_time_iso.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        return max(0, int((now - dt).total_seconds() * 1_000_000))
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Per-topic parsers
# ---------------------------------------------------------------------------

def _chime_frb(raw: dict, event_type: str) -> dict:
    """
    CHIME/FRB VOEvent-JSON schema.
    Key fields: tns_name, ra, dec, dm, snr, width_ms, detection_time
    """
    ra  = _safe_float(raw.get("ra"))
    dec = _safe_float(raw.get("dec"))
    det_time = raw.get("detection_time") or raw.get("event_time") or _now_iso()
    gal_lon, gal_lat = _ra_dec_to_gal(ra, dec)
    sun_d, moon_d    = _sun_moon_distance(ra, dec, det_time)

    return {
        "eventId":       raw.get("tns_name") or raw.get("event_name") or _make_event_id("FRB"),
        "detectionTime": det_time,
        "ra":            ra,
        "dec":           dec,
        "errorRadius":   _safe_float(raw.get("loc_error")),
        "snr":           _safe_float(raw.get("snr")),
        "far":           _safe_float(raw.get("far")),
        "latencyUs":     _latency_us(det_time),
        "galLon":        gal_lon,
        "galLat":        gal_lat,
        "sunDistance":   sun_d,
        "moonDistance":  moon_d,
        "dm":            _safe_float(raw.get("dm")),
        "fluence":       None,
    }


def _einstein_probe(raw: dict, event_type: str) -> dict:
    """
    Einstein Probe WXT alert schema.
    Key fields: ra_obj, dec_obj, err_rad, snr, trigger_time, trigger_id
    """
    ra  = _safe_float(raw.get("ra_obj",  raw.get("ra")))
    dec = _safe_float(raw.get("dec_obj", raw.get("dec")))
    det_time = raw.get("trigger_time") or raw.get("t_start") or _now_iso()
    gal_lon, gal_lat = _ra_dec_to_gal(ra, dec)
    sun_d, moon_d    = _sun_moon_distance(ra, dec, det_time)
    trigger  = raw.get("trigger_id") or raw.get("id") or ""

    return {
        "eventId":       f"EP{trigger}" if trigger else _make_event_id("GRB"),
        "detectionTime": det_time,
        "ra":            ra,
        "dec":           dec,
        "errorRadius":   _safe_float(raw.get("err_rad", raw.get("loc_error"))),
        "snr":           _safe_float(raw.get("image_snr", raw.get("snr"))),
        "far":           _safe_float(raw.get("far")),
        "latencyUs":     _latency_us(det_time),
        "galLon":        gal_lon,
        "galLat":        gal_lat,
        "sunDistance":   sun_d,
        "moonDistance":  moon_d,
        "fluence":       _safe_float(raw.get("fluence")) or None,
        "dm":            None,
    }


def _icecube(raw: dict, event_type: str) -> dict:
    """
    IceCube GOLD/BRONZE and LVK-NuTrack alert schema.
    Key fields: ra, dec, ra_err, dec_err, signalness, far, event_dt
    """
    ra  = _safe_float(raw.get("ra"))
    dec = _safe_float(raw.get("dec"))
    det_time  = raw.get("event_dt") or raw.get("time") or _now_iso()
    gal_lon, gal_lat = _ra_dec_to_gal(ra, dec)
    sun_d, moon_d    = _sun_moon_distance(ra, dec, det_time)

    # IceCube uses separate ra_err / dec_err; use the larger for errorRadius
    ra_err  = _safe_float(raw.get("ra_err",  raw.get("ra_uncertainty",  0.0)))
    dec_err = _safe_float(raw.get("dec_err", raw.get("dec_uncertainty", 0.0)))
    err_radius = max(ra_err, dec_err)

    det_time  = raw.get("event_dt") or raw.get("time") or _now_iso()
    run_id    = raw.get("run_id",   "")
    event_num = raw.get("event_id", raw.get("event_num", ""))
    event_id  = f"IC{run_id}-{event_num}" if run_id and event_num else _make_event_id("NU")

    return {
        "eventId":       event_id,
        "detectionTime": det_time,
        "ra":            ra,
        "dec":           dec,
        "errorRadius":   err_radius,
        "snr":           _safe_float(raw.get("signalness", raw.get("signal_trackness"))),
        "far":           _safe_float(raw.get("far")),
        "latencyUs":     _latency_us(det_time),
        "galLon":        gal_lon,
        "galLat":        gal_lat,
        "sunDistance":   sun_d,
        "moonDistance":  moon_d,
        "fluence":       None,
        "dm":            None,
    }


def _igwn(raw: dict, event_type: str) -> dict:
    """
    IGWN Gravitational Wave alert schema (LVK O4 superevents).
    Key fields: superevent_id, event.time, event.far, event.skymap

    FITS / skymap URL extraction
    ----------------------------
    The LVK payload can carry the sky-localisation FITS URL in several places
    depending on GraceDB version and alert type:

      1. event.skymap       — O4 standard location (most common)
      2. skymap             — top-level alias used in some GraceDB notices
      3. fits_url           — older O3-era field name
      4. localization_url   — GraceDB REST API response field

    We try each in order.  If none resolves to a non-empty string, fitsUrl
    is set to None and no localization row will be written downstream.
    """
    event_block = raw.get("event", {}) or {}
    ra  = _safe_float(event_block.get("ra",  raw.get("ra",  0.0)))
    dec = _safe_float(event_block.get("dec", raw.get("dec", 0.0)))
    det_time = (
        event_block.get("time")
        or raw.get("time_created")
        or raw.get("event_time")
        or _now_iso()
    )
    gal_lon, gal_lat = _ra_dec_to_gal(ra, dec)
    sun_d, moon_d    = _sun_moon_distance(ra, dec, det_time)
    superevent_id = raw.get("superevent_id", _make_event_id("GW"))

    # ── FITS URL extraction ───────────────────────────────────────────────────
    # Try each candidate location; use the first truthy (non-empty) string.
    fits_url: str | None = (
        event_block.get("skymap")
        or raw.get("skymap")
        or raw.get("fits_url")
        or raw.get("localization_url")
        or None
    )
    # Coerce to str or None — reject non-string values (e.g. dicts, lists)
    if fits_url is not None and not isinstance(fits_url, str):
        fits_url = None
    # Empty string → None
    if fits_url is not None and not fits_url.strip():
        fits_url = None

    return {
        "eventId":       superevent_id,
        "detectionTime": det_time,
        "ra":            ra,
        "dec":           dec,
        "errorRadius":   _safe_float(event_block.get("error_radius", raw.get("area_90", 0.0))),
        "snr":           _safe_float(event_block.get("snr",  raw.get("snr"))),
        "far":           _safe_float(event_block.get("far",  raw.get("far"))),
        "latencyUs":     _latency_us(det_time),
        "galLon":        gal_lon,
        "galLat":        gal_lat,
        "sunDistance":   sun_d,
        "moonDistance":  moon_d,
        "fluence":       None,
        "dm":            None,
        "fitsUrl":       fits_url,
    }


def _swift_bat(raw: dict, event_type: str) -> dict:
    """
    Swift-BAT GUANO alert schema.
    Key fields: trigger_num, ra, dec, image_snr, image_significance, trigger_time
    """
    ra  = _safe_float(raw.get("ra"))
    dec = _safe_float(raw.get("dec"))
    det_time  = raw.get("trigger_time") or raw.get("time") or _now_iso()
    gal_lon, gal_lat = _ra_dec_to_gal(ra, dec)
    sun_d, moon_d    = _sun_moon_distance(ra, dec, det_time)
    trig_num  = raw.get("trigger_num", raw.get("burst_trigger", ""))
    event_id  = f"GRB{trig_num}" if trig_num else _make_event_id("GRB")

    return {
        "eventId":       event_id,
        "detectionTime": det_time,
        "ra":            ra,
        "dec":           dec,
        "errorRadius":   _safe_float(raw.get("loc_error", 3.0)),
        "snr":           _safe_float(raw.get("image_snr", raw.get("snr"))),
        "far":           _safe_float(raw.get("far")),
        "latencyUs":     _latency_us(det_time),
        "galLon":        gal_lon,
        "galLat":        gal_lat,
        "sunDistance":   sun_d,
        "moonDistance":  moon_d,
        "fluence":       _safe_float(raw.get("fluence")) or None,
        "dm":            None,
    }


def _generic(raw: dict, event_type: str) -> dict:
    """Last-resort parser for unknown topics."""
    ra  = _safe_float(raw.get("ra"))
    dec = _safe_float(raw.get("dec"))
    det_time = raw.get("time") or raw.get("detection_time") or _now_iso()
    gal_lon, gal_lat = _ra_dec_to_gal(ra, dec)
    sun_d, moon_d    = _sun_moon_distance(ra, dec, det_time)

    return {
        "eventId":       raw.get("event_id") or _make_event_id(event_type),
        "detectionTime": det_time,
        "ra":            ra,
        "dec":           dec,
        "errorRadius":   _safe_float(raw.get("loc_error", raw.get("error_radius"))),
        "snr":           _safe_float(raw.get("snr")),
        "far":           _safe_float(raw.get("far")),
        "latencyUs":     _latency_us(det_time),
        "galLon":        gal_lon,
        "galLat":        gal_lat,
        "sunDistance":   sun_d,
        "moonDistance":  moon_d,
        "fluence":       None,
        "dm":            None,
    }
