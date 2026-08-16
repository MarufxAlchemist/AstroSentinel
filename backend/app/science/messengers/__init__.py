"""
Per-messenger scientific validators (spec sections 9-18).

Each module validates the quantities specific to one messenger and is
registered here. Adding a new messenger (X-ray transient, TDE, magnetar
flare ...) means adding a module and one entry in VALIDATORS — no changes
to the universal validators or the quality score.

Every module exposes:  validate(event: dict, report: ValidationReport) -> None
"""

from typing import Callable

from app.science.messengers import frb, grb, gw, neutrino

#: eventType (upper-case) -> validator
VALIDATORS: dict[str, Callable] = {
    "GRB": grb.validate,
    "GW": gw.validate,
    "FRB": frb.validate,
    "NU": neutrino.validate,
    # Einstein Probe WXT alerts are high-energy transients; the GRB checks
    # (duration, fluence, spectral) apply to them directly.
    "EP": grb.validate,
}


def validate_for_type(event: dict, report) -> None:
    """Dispatch to the messenger-specific validator, if one exists."""
    etype = str(event.get("eventType") or "").upper()
    fn = VALIDATORS.get(etype)
    if fn is not None:
        fn(event, report)


__all__ = ["VALIDATORS", "validate_for_type", "grb", "gw", "frb", "neutrino"]
