import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import type { Position } from './types';

/**
 * Owns the lifecycle of the host-PC geolocation marker — separate from the
 * virtual-GPS avatar. Added / updated / removed in response to the
 * LocatePcButton feature so users can see where their host computer
 * actually is on the map.
 */
export function usePcMarker(
  mapRef: RefObject<L.Map | null>,
  pcPosition: Position | null | undefined,
): void {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pcPosition) {
      if (markerRef.current) {
        try { markerRef.current.remove(); } catch { /* ignore */ }
        markerRef.current = null;
      }
      return;
    }

    const latlng: L.LatLngExpression = [pcPosition.lat, pcPosition.lng];
    const tooltip = `${pcPosition.lat.toFixed(6)}, ${pcPosition.lng.toFixed(6)}`;

    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
      markerRef.current.setTooltipContent(tooltip);
      return;
    }

    const icon = L.divIcon({
      className: 'pc-pos-marker',
      html: `<div data-fc="map.pc-marker" class="map-pin-pc"></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    const marker = L.marker(latlng, {
      icon,
      // Sits above the current-pos avatar (1000) so the pin is always
      // visible even if the two coincide right after a fly-and-teleport.
      zIndexOffset: 1100,
      interactive: true,
    }).addTo(map);
    marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -16] });
    markerRef.current = marker;
  }, [mapRef, pcPosition]);
}
