"""
observability.py
----------------
Altitude, azimuth and airmass for a configured observing site
(spec sections 21-22).

The spec is unambiguous: "Never calculate them using a fictional observatory
location." Altitude and airmass are meaningless without a real observer — they
are properties of a (position, time, place) triple, not of the event. A default
site would silently attach one observatory's sky to every user's dashboard.

So this module has exactly two behaviours:

  * **No site configured** -> every quantity is UNKNOWN, with a note naming the
    environment variables that would enable it. Nothing is estimated.
  * **A site configured** -> real astropy AltAz computation, stamped with the
    site it used and the instant it used.

Configuration
─────────────
    ASTROSENTINEL_SITE_NAME     free text, for display
    ASTROSENTINEL_SITE_LAT      degrees, +N
    ASTROSENTINEL_SITE_LON      degrees, +E
    ASTROSENTINEL_SITE_ELEV_M   metres above sea level (optional, default 0)

Latitude and longitude must both be present and valid. A half-configured site
is a configuration error, reported as such, not silently completed with zeros —
(0, 0) is a real place in the Gulf of Guinea and would produce plausible,
entirely wrong altitudes.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

ENV_NAME = "ASTROSENTINEL_SITE_NAME"
ENV_LAT = "ASTROSENTINEL_SITE_LAT"
ENV_LON = "ASTROSENTINEL_SITE_LON"
ENV_ELEV = "ASTROSENTINEL_SITE_ELEV_M"

#: Below this altitude the target is behind the horizon: airmass is undefined,
#: not "very large".
HORIZON_DEG = 0.0

#: Conventional practical limit for follow-up; below it extinction and
#: differential refraction make photometry unreliable.
LOW_ALTITUDE_DEG = 30.0

CONFIG_HELP = (
    f"Set {ENV_LAT} and {ENV_LON} (degrees; longitude +E), optionally "
    f"{ENV_ELEV} and {ENV_NAME}, to enable observability calculations."
)


@dataclass(frozen=True)
class Site:
    name: str
    lat_deg: float
    lon_deg: float
    elev_m: float

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "latDeg": self.lat_deg,
                "lonDeg": self.lon_deg, "elevM": self.elev_m}


@dataclass(frozen=True)
class SiteConfig:
    """Either a usable site, or the explicit reason there isn't one."""

    site: Site | None
    configured: bool
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "site": self.site.to_dict() if self.site else None,
            "reason": self.reason,
        }


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


def load_site() -> SiteConfig:
    """Read the observing site from the environment. Never invents one."""
    raw_lat = os.getenv(ENV_LAT)
    raw_lon = os.getenv(ENV_LON)

    if not raw_lat and not raw_lon:
        return SiteConfig(None, False,
                          "No observing site is configured, so altitude, azimuth "
                          "and airmass are UNKNOWN for this event. " + CONFIG_HELP)

    if not raw_lat or not raw_lon:
        missing = ENV_LAT if not raw_lat else ENV_LON
        return SiteConfig(None, False,
                          f"Observing site is half-configured: {missing} is not set. "
                          "A partial location is not completed with a default, "
                          "because (0, 0) is a real place and would yield "
                          "plausible but wrong altitudes. " + CONFIG_HELP)

    lat, lon = _num(raw_lat), _num(raw_lon)
    if lat is None or lon is None:
        return SiteConfig(None, False,
                          f"Observing site coordinates are not numeric "
                          f"({ENV_LAT}={raw_lat!r}, {ENV_LON}={raw_lon!r}).")
    if not (-90.0 <= lat <= 90.0):
        return SiteConfig(None, False, f"Site latitude {lat} is outside [-90, +90].")
    if not (-180.0 <= lon <= 360.0):
        return SiteConfig(None, False, f"Site longitude {lon} is outside [-180, +360].")

    elev = _num(os.getenv(ENV_ELEV))
    if elev is None:
        elev = 0.0

    name = (os.getenv(ENV_NAME) or "").strip() or f"({lat:.4f}, {lon:.4f})"
    return SiteConfig(Site(name, lat, lon, elev), True)


def airmass_kasten_young(altitude_deg: float) -> float | None:
    """
    Airmass from true altitude, Kasten & Young (1989).

        X = 1 / (sin(h) + 0.50572 * (h + 6.07995)^-1.6364)      [h in degrees]

    Chosen over the plane-parallel sec(z) because sec(z) diverges at the
    horizon and is already 2% wrong by 60 degrees zenith angle. Undefined
    below the horizon — a target that has set has no airmass, and returning a
    large number there would let it silently rank as "just a poor target".
    """
    h = _num(altitude_deg)
    if h is None or h <= HORIZON_DEG:
        return None
    denom = math.sin(math.radians(h)) + 0.50572 * (h + 6.07995) ** -1.6364
    if denom <= 0:
        return None
    return 1.0 / denom


@dataclass(frozen=True)
class Observability:
    """Result of an observability calculation, or the reason there isn't one."""

    available: bool
    site: Site | None = None
    at_time: str | None = None
    altitude_deg: float | None = None
    azimuth_deg: float | None = None
    airmass: float | None = None
    above_horizon: bool | None = None
    reason: str | None = None
    note: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "site": self.site.to_dict() if self.site else None,
            "atTime": self.at_time,
            "altitudeDeg": self.altitude_deg,
            "azimuthDeg": self.azimuth_deg,
            "airmass": self.airmass,
            "aboveHorizon": self.above_horizon,
            "reason": self.reason,
            "note": self.note,
            "provenance": "DERIVED" if self.available else "UNKNOWN",
        }


def _parse_time(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if not isinstance(v, str) or not v.strip():
        return None
    try:
        dt = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def compute(ra_deg: Any, dec_deg: Any, when: Any,
            config: SiteConfig | None = None) -> Observability:
    """
    Altitude/azimuth/airmass of (ra, dec) from the configured site at `when`.

    Every failure mode returns an Observability with `available=False` and a
    reason. None of them returns a number.
    """
    cfg = config or load_site()
    if not cfg.configured or cfg.site is None:
        return Observability(False, reason=cfg.reason)

    ra, dec = _num(ra_deg), _num(dec_deg)
    if ra is None or dec is None:
        return Observability(False, site=cfg.site,
                             reason="Event has no sky position, so it cannot be "
                                    "pointed at from any site.")

    t = _parse_time(when)
    if t is None:
        return Observability(False, site=cfg.site,
                             reason="No valid timestamp, so the sky rotation angle "
                                    "is unknown and altitude cannot be computed.")

    try:
        import astropy.units as u
        from astropy.coordinates import AltAz, EarthLocation, SkyCoord
        from astropy.time import Time

        loc = EarthLocation(lat=cfg.site.lat_deg * u.deg,
                            lon=cfg.site.lon_deg * u.deg,
                            height=cfg.site.elev_m * u.m)
        target = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
        altaz = target.transform_to(AltAz(obstime=Time(t), location=loc))
        alt = float(altaz.alt.deg)
        az = float(altaz.az.deg)
    except Exception as exc:
        return Observability(False, site=cfg.site,
                             reason=f"Observability could not be computed "
                                    f"({type(exc).__name__}: {exc}).")

    above = alt > HORIZON_DEG
    return Observability(
        available=True,
        site=cfg.site,
        at_time=t.isoformat(),
        altitude_deg=round(alt, 4),
        azimuth_deg=round(az, 4),
        airmass=(round(airmass_kasten_young(alt), 4) if above else None),
        above_horizon=above,
        note=("Geometric altitude at the event's detection time; atmospheric "
              "refraction is not applied. Airmass is undefined below the horizon."),
    )


__all__ = [
    "ENV_NAME", "ENV_LAT", "ENV_LON", "ENV_ELEV", "CONFIG_HELP",
    "HORIZON_DEG", "LOW_ALTITUDE_DEG",
    "Site", "SiteConfig", "Observability",
    "load_site", "compute", "airmass_kasten_young",
]
