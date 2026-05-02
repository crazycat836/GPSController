import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { ACCENT_HEX } from '../../lib/constants';
import type { Position } from './types';

/**
 * Owns the dual-layer route polyline lifecycle: a wide faint glow plus a
 * thin dashed accent line with a CSS `route-line-flow` animation, giving
 * the subtle "flowing arrow" look the redesign ships in v0.2.48.
 */
export function useRoutePolyline(
  mapRef: RefObject<L.Map | null>,
  routePath: Position[],
): void {
  const glowRef = useRef<L.Polyline | null>(null);
  const overlayRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (glowRef.current) {
      glowRef.current.remove();
      glowRef.current = null;
    }
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }

    if (routePath.length > 1) {
      const latlngs: L.LatLngExpression[] = routePath.map((p) => [p.lat, p.lng]);
      // Wide faint glow (design: stroke-width 0.022, opacity 0.08).
      // ACCENT_HEX mirrors `--color-accent`; Leaflet writes it to an SVG
      // `stroke` attribute which doesn't resolve CSS vars.
      const glow = L.polyline(latlngs, {
        color: ACCENT_HEX,
        weight: 12,
        opacity: 0.08,
        lineCap: 'round',
        interactive: false,
      }).addTo(map);
      glowRef.current = glow;
      // Thin accent dashed main line (design: stroke-width 0.005,
      // stroke-dasharray "0.012 0.016" with stroke-linecap round).
      const main = L.polyline(latlngs, {
        color: ACCENT_HEX,
        weight: 2.5,
        opacity: 0.95,
        dashArray: '6 8',
        lineCap: 'round',
        className: 'route-line-flow',
        interactive: false,
      }).addTo(map);
      overlayRef.current = main;
    }
  }, [mapRef, routePath]);
}
