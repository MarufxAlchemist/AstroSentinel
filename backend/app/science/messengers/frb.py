"""
frb.py
------
Fast radio burst validation (spec section 17).

The central discipline here is the dispersion-measure decomposition:

    DM_total = DM_MW + DM_host + DM_IGM

Only DM_total is measured. DM_MW requires a Galactic electron-density model
(NE2001 or YMW16); neither is available in this deployment, so DM_MW and
therefore the extragalactic excess are UNKNOWN unless the notice supplies
them. When they are supplied the decomposition is checked for consistency.

DM_excess is explicitly NOT converted to a redshift. The Macquart relation has
very large scatter from host and IGM contributions along individual sight
lines; a per-event z from DM alone would be a model estimate dressed up as a
measurement.
"""

from __future__ import annotations

from typing import Any

from app.science.diagnostics import ValidationReport
from app.science.uncertainty import Measurement

#: Observed FRB DMs (pc/cm3). Below ~20 is almost certainly Galactic;
#: above ~8000 exceeds anything catalogued.
DM_MIN, DM_MAX = 1.0, 8000.0

#: Pulse widths outside this range (ms) suggest a unit error.
WIDTH_MIN_MS, WIDTH_MAX_MS = 1e-3, 1e4

#: CHIME/FRB and most radio facilities operate between these (MHz).
FREQ_MIN_MHZ, FREQ_MAX_MHZ = 100.0, 10_000.0


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def validate(ev: dict[str, Any], rep: ValidationReport) -> None:
    dm = _num(ev.get("dm"))
    dm_mw = _num(ev.get("dmGalactic") or ev.get("dm_mw"))
    dm_excess = _num(ev.get("dmExcess") or ev.get("dm_excess"))

    # ── Dispersion measure ──────────────────────────────────────────────────
    if dm is None:
        rep.warning("frb_dm_missing",
                    "No dispersion measure reported. DM is the defining "
                    "observable of an FRB and is needed for any distance "
                    "inference.", "dm")
    else:
        if dm <= 0:
            rep.error("frb_dm_non_positive",
                      f"DM {dm} pc/cm3 is not positive.", "dm", dm)
        elif not (DM_MIN <= dm <= DM_MAX):
            rep.warning("frb_dm_implausible",
                        f"DM {dm} pc/cm3 is outside the catalogued FRB range "
                        f"({DM_MIN}-{DM_MAX}); check units and the de-dispersion.",
                        "dm", dm)

    # ── Decomposition ───────────────────────────────────────────────────────
    if dm is not None and dm_mw is not None:
        if dm_mw < 0:
            rep.error("frb_dm_mw_negative",
                      f"Galactic DM contribution {dm_mw} is negative.",
                      "dmGalactic", dm_mw)
        elif dm_mw > dm:
            rep.error("frb_dm_mw_exceeds_total",
                      f"The Galactic DM contribution ({dm_mw}) exceeds the total DM "
                      f"({dm}). The decomposition is inconsistent — an extragalactic "
                      "origin cannot be inferred from it.", "dmGalactic", dm_mw)
        else:
            implied = dm - dm_mw
            if dm_excess is not None and abs(implied - dm_excess) > 1.0:
                rep.error("frb_dm_excess_inconsistent",
                          f"Reported DM excess ({dm_excess}) does not match "
                          f"DM_total - DM_MW ({implied:.1f}).", "dmExcess", dm_excess)
            else:
                # Propagate the reported errors. A Galactic-model DM carries a
                # substantial model uncertainty (tens of pc/cm3 in the plane),
                # so the excess is markedly less certain than the measured
                # total — printing a bare difference would hide that.
                total_m = Measurement.of(dm, ev.get("dmError"))
                mw_m = Measurement.of(dm_mw, ev.get("dmGalacticError"))
                excess = total_m.minus(mw_m) if (total_m and mw_m) else None
                shown = (excess.render(4, "pc/cm3")
                         if excess is not None and excess.sigma is not None
                         else f"{implied:.1f} pc/cm3")
                rep.info("frb_dm_excess",
                         f"Extragalactic DM excess = {shown} "
                         "(DM_total - DM_MW). This is not a distance: host and IGM "
                         "contributions are not separable from it.",
                         "dm", round(implied, 2))
    elif dm is not None:
        rep.info("frb_dm_decomposition_unavailable",
                 "The Galactic DM contribution is not reported and no electron-"
                 "density model (NE2001/YMW16) is available here, so the "
                 "extragalactic excess is UNKNOWN rather than estimated.", "dm")

    # Redshift from DM is deliberately not derived.
    if dm is not None and _num(ev.get("redshift")) is None:
        rep.info("frb_redshift_not_derived",
                 "No redshift is derived from DM. The Macquart relation has large "
                 "sight-line scatter from host and IGM contributions, so a "
                 "per-event redshift from DM alone would be a model estimate, not "
                 "a measurement.", "redshift")

    # ── Burst properties ────────────────────────────────────────────────────
    width = _num(ev.get("widthMs") or ev.get("width_ms") or ev.get("pulseWidth"))
    if width is not None:
        if width <= 0:
            rep.error("frb_width_non_positive",
                      f"Pulse width {width} ms is not positive.", "widthMs", width)
        elif not (WIDTH_MIN_MS <= width <= WIDTH_MAX_MS):
            rep.warning("frb_width_implausible",
                        f"Pulse width {width} ms is outside the plausible range; "
                        "check whether the unit is ms or s.", "widthMs", width)

    freq = _num(ev.get("frequencyMhz") or ev.get("centreFrequency"))
    if freq is not None and not (FREQ_MIN_MHZ <= freq <= FREQ_MAX_MHZ):
        rep.warning("frb_frequency_implausible",
                    f"Centre frequency {freq} MHz is outside the range of current "
                    "radio facilities; check whether the unit is MHz or GHz.",
                    "frequencyMhz", freq)

    scatt = _num(ev.get("scatteringMs") or ev.get("scattering_time"))
    if scatt is not None and scatt < 0:
        rep.error("frb_scattering_negative",
                  f"Scattering time {scatt} ms is negative.", "scatteringMs", scatt)

    # ── Repetition ──────────────────────────────────────────────────────────
    if ev.get("isRepeater") is True:
        rep.notice("frb_repeater",
                   "Source is flagged as a known repeater. Repeaters and "
                   "apparent one-off bursts may have different progenitors; "
                   "treat population inferences accordingly.", "isRepeater", True)
