import React from "react";
import { AstroEventEventType } from "@workspace/api-client-react/src/generated/api.schemas";
import { Badge } from "@/components/ui/badge";

interface EventBadgeProps {
  type: AstroEventEventType;
}

export function EventBadge({ type }: EventBadgeProps) {
  let className = "bg-primary text-primary-foreground";
  switch (type) {
    case "GRB":
      className = "bg-amber-500/10 text-amber-500 border-amber-500/20";
      break;
    case "GW":
      className = "bg-violet-500/10 text-violet-500 border-violet-500/20";
      break;
    case "FRB":
      className = "bg-cyan-500/10 text-cyan-500 border-cyan-500/20";
      break;
  }

  return (
    <Badge variant="outline" className={`font-mono font-bold tracking-wider ${className}`}>
      {type}
    </Badge>
  );
}
