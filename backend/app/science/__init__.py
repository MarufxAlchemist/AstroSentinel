"""Scientific validation, derivation and quality assessment for events."""

from app.science.diagnostics import (
    Diagnostic,
    Level,
    ValidationReport,
)
from app.science.validators import validate_event
from app.science.quality import score_quality

__all__ = [
    "Diagnostic",
    "Level",
    "ValidationReport",
    "validate_event",
    "score_quality",
]

# The Phase 5 modules — units, uncertainty, cosmology, observability,
# derivations — are deliberately NOT re-exported here. `cosmology` and
# `observability` construct astropy objects on first use, and validation must
# not pay that cost, or risk that import, when only diagnostics are wanted.
# Import them directly:  from app.science import cosmology
