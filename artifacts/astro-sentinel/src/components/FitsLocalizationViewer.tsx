import React, { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, CircleDot } from "lucide-react";
import type { AstroEvent } from "@workspace/api-client-react";
import { AladinMetadataPanel } from "./AladinMetadataPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FitsLocalizationViewerProps {
  /** The full astrophysical event */
  event: AstroEvent;
  /** Viewer height in px (default: 540) */
  height?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AladinStatic = any;

function arcminToDeg(arcmin: number): number {
  return arcmin / 60;
}

function circleEdgePosition(
  ra: number,
  dec: number,
  radiusDeg: number,
): [number, number] {
  return [ra, Math.min(90, dec + radiusDeg)];
}

const FILL_COLOR   = "rgba(52, 211, 153, 0.10)"; 
const BORDER_COLOR = "#34d399";                  

// ── Component ─────────────────────────────────────────────────────────────────

export function FitsLocalizationViewer({
  event,
  height = 540,
}: FitsLocalizationViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const aladinRef    = useRef<AladinStatic | null>(null);
  const aRef         = useRef<AladinStatic | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [localization, setLocalization] = useState<any | null>(null);
  const [locStatus, setLocStatus] = useState<"loading" | "ready" | "error" | "none">("loading");

  const { ra, dec, eventId, errorRadius } = event;

  /**
   * What the drawn circle actually contains (spec section 23).
   *
   * This viewer previously labelled every circle "1σ Error Radius". That was a
   * claim the data does not support: most sources never state a containment
   * convention, and a 90% credible radius is 2.15x the 1σ radius for a 2-D
   * Gaussian. Drawing one and calling it the other misrepresents the search
   * area by a factor of ~4.6 in solid angle. The label now reflects what the
   * source said, and says "convention not stated" when it said nothing.
   */
  const containment = (event as { errorRadiusContainment?: string | null })
    .errorRadiusContainment;
  const CONTAINMENT_LABELS: Record<string, string> = {
    "1SIGMA_1D": "1σ (68.27%, 1-D)",
    "1SIGMA_2D": "1σ radius of a 2-D Gaussian (39.35%)",
    "50_2D": "50% credible region",
    "68_2D": "68.27% containment (2-D)",
    "90_2D": "90% credible region",
    "95_2D": "95% credible region",
  };
  const containmentLabel = containment
    ? CONTAINMENT_LABELS[containment] ?? containment
    : "containment convention not stated by the source";

  const hasCircle = typeof errorRadius === "number" && errorRadius > 0;
  const radiusDeg = hasCircle ? arcminToDeg(errorRadius!) : 0;
  const target = `${ra.toFixed(6)} ${dec.toFixed(6)}`;

  // Fetch localization metadata
  useEffect(() => {
    setLocStatus("loading");
    setLocalization(null);

    fetch(`/api/events/${event.id}/localizations`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch localizations");
        return res.json();
      })
      .then((data: any[]) => {
        if (data && data.length > 0) {
          setLocalization(data[0]);
          setLocStatus("ready");
        } else {
          setLocStatus("none");
        }
      })
      .catch((err) => {
        console.error("Failed to load localizations:", err);
        setLocStatus("error");
      });
  }, [event.id]);

  // Initialise Aladin Lite
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    async function init() {
      try {
        const mod = await import("aladin-lite");
        const A: AladinStatic = mod.default ?? mod;
        if (cancelled) return;

        await A.init;
        if (cancelled || !containerRef.current) return;

        aRef.current = A;

        const fovDeg = hasCircle ? Math.max(0.5, radiusDeg * 8) : 2.0;

        const aladin: AladinStatic = A.aladin(containerRef.current, {
          survey:                   "P/DSS2/color",
          fov:                      fovDeg,
          target,
          cooFrame:                 "ICRSd",
          showFullscreenControl:    false,
          showLayersControl:        true,
          showGotoControl:          false,
          showShareControl:         false,
          showSimbadPointerControl: false,
          showCooGrid:              true,
          showCooGridControl:       false,
          showProjectionControl:    false,
          showContextMenu:          false,
          showStatusBar:            false,
          backgroundColor:          "#0a0f1e",
        });

        aladinRef.current = aladin;

        const markerCat = A.catalog({
          name:       eventId ?? "Event",
          sourceSize: 20,
          color:      BORDER_COLOR,
        });
        aladin.addCatalog(markerCat);

        markerCat.addSources([
          A.source(ra, dec, {
            popupTitle: eventId ?? "Astrophysical Event",
            popupDesc:
              `<b>RA:</b> ${ra.toFixed(6)}°<br/>` +
              `<b>Dec:</b> ${dec.toFixed(6)}°` +
              (hasCircle
                ? `<br/><b>Localization radius:</b> ${errorRadius!.toFixed(2)}'` +
                  ` (${radiusDeg.toFixed(4)}°)` +
                  `<br/><span style="color:#9ca3af">${containmentLabel}</span>`
                : ""),
          }),
        ]);

        if (hasCircle) {
          const fillOverlay = A.graphicOverlay({ color: FILL_COLOR, lineWidth: 0 });
          aladin.addOverlay(fillOverlay);
          fillOverlay.add(A.circle(ra, dec, radiusDeg));

          const borderOverlay = A.graphicOverlay({ color: BORDER_COLOR, lineWidth: 2 });
          aladin.addOverlay(borderOverlay);
          borderOverlay.add(A.circle(ra, dec, radiusDeg));

          const [edgeRa, edgeDec] = circleEdgePosition(ra, dec, radiusDeg);
          const edgeCat = A.catalog({ name: "Error circle", sourceSize: 8, color: BORDER_COLOR, shape: "square" });
          aladin.addCatalog(edgeCat);
          edgeCat.addSources([
            A.source(edgeRa, edgeDec, {
              popupTitle: "Localization radius",
              popupDesc:
                `<b>${errorRadius!.toFixed(2)}</b> arcmin (${radiusDeg.toFixed(4)}°)<br/>` +
                `<span style="color:#9ca3af">${containmentLabel}</span>`,
            }),
          ]);
        }

        if (!cancelled) setStatus("ready");
      } catch (err) {
        console.error("[FitsLocalizationViewer] Aladin Lite init failed:", err);
        if (!cancelled) setStatus("error");
      }
    }

    init();

    return () => {
      cancelled = true;
      aladinRef.current = null;
    };
  }, [target, radiusDeg, eventId, ra, dec, errorRadius, hasCircle, containmentLabel]);

  // Load FITS overlay when available
  useEffect(() => {
    if (status !== "ready" || !aladinRef.current || !aRef.current || !localization?.fitsUrl) return;

    const aladin = aladinRef.current;
    const A = aRef.current;
    
    // We try to add the FITS overlay
    console.log("Loading FITS:", localization.fitsUrl);
    
    // Aladin Lite v3 FITS overlay
    aladin.displayFITS(localization.fitsUrl, {
      name: `FITS ${localization.method}`,
      opacity: 0.7,
      colormap: "magma"
    }, (raResult: number, decResult: number, fov: number, image: any) => {
       console.log("FITS loaded successfully", { raResult, decResult, fov });
    });

  }, [status, localization]);

  return (
    <div className="flex flex-col md:flex-row w-full rounded-lg overflow-hidden border border-border/50 bg-card">
      <div className="flex-1 flex flex-col space-y-0 relative">
        <div className="relative w-full overflow-hidden" style={{ height }}>
          <div
            ref={containerRef}
            id={`aladin-${(eventId ?? "viewer").replace(/[^a-z0-9]/gi, "-")}`}
            className="absolute inset-0 bg-[#0a0f1e]"
          />

          {(status === "loading" || locStatus === "loading") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm gap-3 z-10">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {status === "loading" ? "Loading Aladin Lite viewer…" : "Loading localization map..."}
              </p>
            </div>
          )}

          {(status === "error" || locStatus === "error") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3 z-10">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <p className="text-sm text-muted-foreground text-center px-6">
                {status === "error" 
                  ? "Could not load Aladin Lite viewer." 
                  : "Failed to load localization product."}
              </p>
            </div>
          )}

          {status === "ready" && (
            <div className="absolute bottom-3 left-3 z-10 bg-black/60 backdrop-blur-sm rounded-md px-2.5 py-1.5 text-xs font-mono text-muted-foreground pointer-events-none select-none border border-border/50">
              {eventId && <span className="text-emerald-400 font-semibold">{eventId} </span>}
              RA {ra.toFixed(4)}° &nbsp; Dec {dec.toFixed(4)}°
            </div>
          )}
        </div>

        {status === "ready" && (
          <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground bg-black/40 border-t border-border/50">
            <div className="flex items-center gap-1.5">
              <CircleDot className="w-3.5 h-3.5 text-emerald-400" />
              <span className="uppercase tracking-wider font-semibold">Localization Radius</span>
            </div>
            {hasCircle ? (
              <span className="font-mono">
                <span className="text-emerald-400 font-semibold">{errorRadius!.toFixed(2)}'</span>
                &nbsp;<span className="opacity-60">({radiusDeg.toFixed(4)}°)</span>
                &nbsp;<span className={containment ? "opacity-60" : "text-amber-500/80"}>{containmentLabel}</span>
              </span>
            ) : (
              <span className="opacity-50 italic font-mono">not available</span>
            )}
          </div>
        )}
      </div>

      <div className="w-full md:w-80 lg:w-96 shrink-0 border-t md:border-t-0 md:border-l border-border/50 bg-black/20">
        <AladinMetadataPanel event={event} localization={localization} />
      </div>
    </div>
  );
}
