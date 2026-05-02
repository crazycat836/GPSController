import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { ACCENT_HEX } from '../../lib/constants';
import type { Position } from './types';

function pathSig(path: Position[]): string {
  if (path.length === 0) return '';
  const first = path[0];
  const last = path[path.length - 1];
  return `${path.length}:${first.lat.toFixed(7)},${first.lng.toFixed(7)}:${last.lat.toFixed(7)},${last.lng.toFixed(7)}`;
}

/**
 * Owns the dual-layer route polyline lifecycle: a wide faint glow plus a
 * thin dashed accent line with a CSS `route-line-flow` animation.
 *
 * ACCENT_HEX mirrors `--color-accent`; Leaflet writes it to an SVG
 * `stroke` attribute which doesn't resolve CSS vars.
 */
export function useRoutePolyline(
  mapRef: RefObject<L.Map | null>,
  routePath: Position[],
): void {
  const glowRef = useRef<L.Polyline | null>(null);
  const overlayRef = useRef<L.Polyline | null>(null);
  const sigRef = useRef<string>('');

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sig = pathSig(routePath);
    if (sig === sigRef.current) return;
    sigRef.current = sig;

    const visible = routePath.length > 1;
    const latlngs: L.LatLngExpression[] = visible
      ? routePath.map((p) => [p.lat, p.lng])
      : [];

    if (!visible) {
      glowRef.current?.remove();
      overlayRef.current?.remove();
      glowRef.current = null;
      overlayRef.current = null;
      return;
    }

    if (glowRef.current && overlayRef.current) {
      glowRef.current.setLatLngs(latlngs);
      overlayRef.current.setLatLngs(latlngs);
      return;
    }

    glowRef.current = L.polyline(latlngs, {
      color: ACCENT_HEX,
      weight: 12,
      opacity: 0.08,
      lineCap: 'round',
      interactive: false,
    }).addTo(map);

    overlayRef.current = L.polyline(latlngs, {
      color: ACCENT_HEX,
      weight: 2.5,
      opacity: 0.95,
      dashArray: '6 8',
      lineCap: 'round',
      className: 'route-line-flow',
      interactive: false,
    }).addTo(map);

    return () => {
      glowRef.current?.remove();
      overlayRef.current?.remove();
      glowRef.current = null;
      overlayRef.current = null;
    };
  }, [mapRef, routePath]);
}
