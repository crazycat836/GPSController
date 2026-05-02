import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { ACCENT_HEX } from '../../lib/constants';
import type { Position } from './types';

/**
 * Owns the lifecycle of the destination teardrop marker. Skips redundant
 * recreations by hashing the destination lat/lng to a fixed-precision
 * signature; only rebuilds the Leaflet marker when the position actually
 * moves.
 */
export function useDestinationMarker(
  mapRef: RefObject<L.Map | null>,
  destination: Position | null,
  destinationLabel: string,
): void {
  const markerRef = useRef<L.Marker | null>(null);
  const sigRef = useRef<string | null>(null);
  // Mirror the orchestrator's `tRef` pattern: stash the latest label so the
  // destination-deps effect picks it up without subscribing to label changes.
  // Preserves the original behavior where the tooltip text is captured at
  // marker-creation time only.
  const labelRef = useRef(destinationLabel);
  labelRef.current = destinationLabel;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sig = destination ? `${destination.lat.toFixed(7)},${destination.lng.toFixed(7)}` : null;
    if (sig === sigRef.current) return;
    sigRef.current = sig;

    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (!destination) return;

    // Flat teardrop — accent stroke over semi-transparent dark fill,
    // inner ring. Mirrors redesign/Home `.pin.dest-flat` SVG verbatim.
    const icon = L.divIcon({
      className: 'dest-marker',
      html: `<div data-fc="map.dest-marker" class="map-pin-dest">
        <svg width="28" height="38" viewBox="0 0 28 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2C8.477 2 4 6.477 4 12c0 7.732 10 24 10 24s10-16.268 10-24c0-5.523-4.477-10-10-10z"
                fill="rgba(10,10,12,0.6)" stroke="${ACCENT_HEX}" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="14" cy="12" r="4" fill="none" stroke="${ACCENT_HEX}" stroke-width="2"/>
        </svg>
      </div>`,
      iconSize: [28, 38],
      iconAnchor: [14, 38],
    });

    const marker = L.marker([destination.lat, destination.lng], { icon }).addTo(map);
    marker.bindTooltip(labelRef.current, { direction: 'top', offset: [0, -38] });
    markerRef.current = marker;
  }, [mapRef, destination]);
}
