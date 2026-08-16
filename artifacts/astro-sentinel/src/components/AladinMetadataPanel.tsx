import React, { useState } from "react";
import type { AstroEvent } from "@workspace/api-client-react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { formatMicrosecondDate, formatMeasured, formatDerived } from "@/lib/formatters";
import { buildExternalLinks } from "./BasicInfo";

interface Props {
  event: AstroEvent;
  localization?: any | null;
}

function getLocalizationQuality(area90: number) {
  if (area90 <= 20) return { label: "Precise", color: "text-emerald-400" };
  if (area90 <= 200) return { label: "Moderate", color: "text-amber-400" };
  return { label: "Broad", color: "text-rose-400" };
}

function AreaVisualizer({ area, label, color }: { area: number, label: string, color: string }) {
  // Logarithmic scale for visual bar relative to full sky (41253 deg²)
  const maxLog = Math.log10(41253);
  const valLog = Math.max(0, Math.log10(Math.max(1, area)));
  const percentage = Math.min(100, (valLog / maxLog) * 100);

  return (
    <div className="flex flex-col gap-1 mt-1.5 mb-2">
      <div className="flex justify-between items-baseline text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{area.toFixed(1)} deg²</span>
      </div>
      <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-border/30">
        <div 
          className={`h-full ${color} bg-current rounded-full opacity-80`} 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function CopyableRow({ label, value, copyValue }: { label: string; value: React.ReactNode; copyValue?: string }) {
  const [copied, setCopied] = useState(false);
  const textToCopy = copyValue ?? (typeof value === "string" ? value : "");

  const handleCopy = () => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-border/40 last:border-0 group">
      <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-right text-foreground">{value}</span>
        {textToCopy && (
          <button
            onClick={handleCopy}
            className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">
        {label}
      </span>
      <span className="font-mono text-sm text-right text-foreground">{value ?? "N/A"}</span>
    </div>
  );
}

function getLifecycleColor(lifecycle: string) {
  switch (lifecycle) {
    case "confirmed":
      return "text-emerald-400";
    case "update":
      return "text-blue-400";
    case "initial":
      return "text-amber-400";
    case "preliminary":
    default:
      return "text-purple-400";
  }
}

export function AladinMetadataPanel({ event, localization }: Props) {
  const externalLinks = buildExternalLinks(event);

  return (
    <div className="flex flex-col h-full bg-card/50 border-l border-border/50 p-4 overflow-y-auto">
      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Event Information
        </h3>
        <div className="space-y-0">
          <CopyableRow label="Event ID" value={event.eventId} />
          <Row label="Type" value={event.eventType} />
          <Row label="Observatory" value={event.observatory} />
          <div className="flex justify-between items-baseline py-1.5 border-b border-border/40">
            <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">Lifecycle</span>
            <div className="flex items-center gap-1.5 font-mono text-sm">
              <span className={`text-[10px] ${getLifecycleColor(event.lifecycle)}`}>●</span>
              <span className="capitalize">{event.lifecycle}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Coordinates
        </h3>
        <div className="space-y-0">
          <CopyableRow label="RA" value={formatMeasured(event.ra, 3, "°")} copyValue={formatMeasured(event.ra, 6)} />
          <CopyableRow label="DEC" value={formatMeasured(event.dec, 3, "°")} copyValue={formatMeasured(event.dec, 6)} />
          <Row label="Galactic Lon" value={formatDerived(event.galLon, 1)} />
          <Row label="Galactic Lat" value={formatDerived(event.galLat, 1)} />
        </div>
      </div>

      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Localization & Visibility
        </h3>
        <div className="space-y-0">
          <Row 
            label="Error Radius" 
            value={event.errorRadius && event.errorRadius > 0 ? `${event.errorRadius.toFixed(1)} arcmin` : "N/A"} 
          />
          <Row label="Sun Distance" value={formatDerived(event.sunDistance, 1)} />
          <Row label="Moon Distance" value={formatDerived(event.moonDistance, 1)} />
          <Row 
            label="Detection Time" 
            value={
              <span className="text-xs">
                {formatMicrosecondDate(event.detectionTime)}
              </span>
            } 
          />
        </div>
      </div>

      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Localization Product
        </h3>
        {localization?.fitsUrl ? (
          <div className="space-y-2">
            <div className="space-y-0">
              <Row label="Method" value={localization.method ?? "Unknown"} />
              {localization.nside && <Row label="HEALPix Nside" value={localization.nside} />}
            </div>
            
            {localization.area90Deg2 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <div className="flex justify-between items-baseline mb-2">
                   <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">Quality</span>
                   <span className={`font-mono text-sm font-semibold ${getLocalizationQuality(localization.area90Deg2).color}`}>
                     {getLocalizationQuality(localization.area90Deg2).label}
                   </span>
                </div>
                
                {localization.area50Deg2 && (
                   <AreaVisualizer area={localization.area50Deg2} label="50% Region" color="text-indigo-400" />
                )}
                <AreaVisualizer area={localization.area90Deg2} label="90% Region" color="text-purple-400" />
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic bg-black/20 p-3 rounded border border-border/50 text-center">
            No localization map available.
          </div>
        )}
      </div>

      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Scientific Summary
        </h3>
        <div className="bg-black/30 rounded-lg p-3 text-xs space-y-2 border border-border/50">
          <div>
            <span className="text-muted-foreground">Sun Distance: </span>
            <span className="font-mono text-foreground">{formatDerived(event.sunDistance, 1)} </span>
            <span className={(event.sunDistance ?? 0) > 45 ? "text-emerald-400" : "text-amber-400"}>
              ({(event.sunDistance ?? 0) > 45 ? "Good" : "Poor"})
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Moon Distance: </span>
            <span className="font-mono text-foreground">{formatDerived(event.moonDistance, 1)} </span>
            <span className={(event.moonDistance ?? 0) > 45 ? "text-emerald-400" : "text-amber-400"}>
              ({(event.moonDistance ?? 0) > 45 ? "Good" : "Poor"})
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Localization: </span>
            <span className="font-mono text-foreground">
              {event.errorRadius && event.errorRadius > 0 ? `${event.errorRadius.toFixed(1)}'` : "N/A"} 
            </span>
            {event.errorRadius && event.errorRadius > 0 && (
              <span className={event.errorRadius < 60 ? "text-emerald-400 ml-1" : "text-amber-400 ml-1"}>
                ({event.errorRadius < 60 ? "Precise" : "Wide"})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          External Links
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {externalLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-2 rounded border border-border/50 bg-black/20 hover:bg-accent/30 hover:border-muted-foreground transition-colors no-underline group"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm leading-none">{link.icon}</span>
                <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                  {link.name}
                </span>
              </div>
              <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
