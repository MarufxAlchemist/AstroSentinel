import { format } from "date-fns";

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
