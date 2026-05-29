import type { AstroEvent } from "@workspace/api-client-react";

interface Props {
  event: AstroEvent;
}

export function PriorityBadge({ event }: Props) {
  const level = event.snr > 20 ? "HIGH" : event.snr > 10 ? "MEDIUM" : "LOW";
  const classes =
    level === "HIGH"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : level === "MEDIUM"
      ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
      : "bg-green-500/15 text-green-400 border-green-500/30";

  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-mono ${classes}`}>{level}</span>;
}
