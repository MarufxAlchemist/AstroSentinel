import { format } from "date-fns";

/** Rendered in place of a DERIVED quantity that could not be computed. */
export const UNKNOWN_LABEL = "—";

/**
 * Format a possibly-null DERIVED scientific quantity.
 *
 * A null value means UNKNOWN: the pipeline could not responsibly derive it.
 * It must never be rendered as 0, 90, or any other stand-in number, so this
 * returns a visually distinct placeholder instead.
 */
export function formatDerived(
  value: number | null | undefined,
  digits: number,
  unit = "°",
): string {
  if (value == null || !Number.isFinite(value)) return UNKNOWN_LABEL;
  return `${value.toFixed(digits)}${unit}`;
}

export function formatMicrosecondDate(isoString: string) {
  // e.g. "2026-05-03T04:21:59.000084" -> "2026-05-03 04:21:59.000084 UTC"
  try {
    const parts = isoString.split('T');
    if (parts.length !== 2) return isoString;
    const datePart = parts[0];
    const timePart = parts[1].replace('Z', '');
    return `${datePart} ${timePart} UTC`;
  } catch (e) {
    return isoString;
  }
}

export function formatLatency(microseconds: number) {
  if (microseconds < 1000) {
    return `${microseconds} μs`;
  }
  const ms = microseconds / 1000;
  return `${ms.toFixed(2)} ms`;
}
