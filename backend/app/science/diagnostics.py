"""
diagnostics.py
--------------
Diagnostic model for scientific validation (spec section 36).

A Diagnostic is a single machine-readable finding about one event. Diagnostics
never mutate the event and never reject it — rejection is the job of the
Node-side alertFilter. Validation only *describes* what is wrong, so a
researcher can judge the data themselves.

Levels
──────
  INFO      Neutral observation worth recording.
  NOTICE    Something a researcher should be aware of (e.g. localization
            improved between revisions).
  WARNING   The value is usable but questionable, or an expected quantity is
            missing.
  ERROR     The value is physically impossible or internally inconsistent.
  CRITICAL  The event cannot be trusted as a scientific record at all.

Every Diagnostic carries the `field` it concerns and a stable `code` so the
frontend and any downstream analysis can group findings without parsing prose.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from enum import IntEnum
from typing import Any


class Level(IntEnum):
    """Ordered so severity comparisons are natural (max() gives the worst)."""

    INFO = 10
    NOTICE = 20
    WARNING = 30
    ERROR = 40
    CRITICAL = 50

    @property
    def label(self) -> str:
        return self.name


@dataclass(frozen=True)
class Diagnostic:
    """One validation finding."""

    level: Level
    code: str
    field: str | None
    message: str
    #: The offending value, when quoting it helps a human judge the finding.
    value: Any = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "level": self.level.label,
            "code": self.code,
            "field": self.field,
            "message": self.message,
            "value": self.value,
        }


@dataclass
class ValidationReport:
    """All diagnostics for one event, plus the derived quality assessment."""

    diagnostics: list[Diagnostic] = dc_field(default_factory=list)

    # ── construction helpers ────────────────────────────────────────────────

    def add(
        self,
        level: Level,
        code: str,
        message: str,
        field: str | None = None,
        value: Any = None,
    ) -> None:
        self.diagnostics.append(
            Diagnostic(level=level, code=code, field=field, message=message, value=value)
        )

    def info(self, code: str, message: str, field: str | None = None, value: Any = None) -> None:
        self.add(Level.INFO, code, message, field, value)

    def notice(self, code: str, message: str, field: str | None = None, value: Any = None) -> None:
        self.add(Level.NOTICE, code, message, field, value)

    def warning(self, code: str, message: str, field: str | None = None, value: Any = None) -> None:
        self.add(Level.WARNING, code, message, field, value)

    def error(self, code: str, message: str, field: str | None = None, value: Any = None) -> None:
        self.add(Level.ERROR, code, message, field, value)

    def critical(self, code: str, message: str, field: str | None = None, value: Any = None) -> None:
        self.add(Level.CRITICAL, code, message, field, value)

    # ── queries ─────────────────────────────────────────────────────────────

    @property
    def worst(self) -> Level | None:
        return max((d.level for d in self.diagnostics), default=None)

    @property
    def status(self) -> str:
        """PASS | WARNING | FAIL — the single headline verdict."""
        w = self.worst
        if w is None or w <= Level.NOTICE:
            return "PASS"
        if w == Level.WARNING:
            return "WARNING"
        return "FAIL"

    def count(self, level: Level) -> int:
        return sum(1 for d in self.diagnostics if d.level == level)

    def codes(self) -> list[str]:
        return [d.code for d in self.diagnostics]

    def has(self, code: str) -> bool:
        return any(d.code == code for d in self.diagnostics)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "worstLevel": self.worst.label if self.worst else None,
            "counts": {
                lvl.label: self.count(lvl) for lvl in Level if self.count(lvl)
            },
            "diagnostics": [d.to_dict() for d in self.diagnostics],
        }
