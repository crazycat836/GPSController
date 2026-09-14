import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { ACCENT_HEX } from '../../lib/constants';
import { coordKey } from '../../lib/format';
import type { Position } from './types';

/**
 * Flower-mode preview: one dashed circle of `radiusM` around every staged
 * waypoint, so the user sees the area each spot will cover before
 * starting. Removed when `radiusM` is null (any other mode).
 *
 * ACCENT_HEX mirrors `--color-accent`; Leaflet writes it to SVG
 * attributes, which don't resolve CSS vars.
 */
export function useFlowerCircles(
  mapRef: RefObject<L.Map | null>,
  centers: Position[],
  radiusM: number | null,
): void {
  const circlesRef = useRef<L.Circle[]>([]);

  const sig = radiusM == null
    ? ''
    : `${radiusM}|${centers.map((c) => coordKey(c)).join('|')}`;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    circlesRef.current.forEach((c) => c.remove());
    circlesRef.current = [];
    if (radiusM == null) return;

    circlesRef.current = centers.map((c) => L.circle([c.lat, c.lng], {
      radius: radiusM,
      color: ACCENT_HEX,
      weight: 2,
      opacity: 0.7,
      fillColor: ACCENT_HEX,
      fillOpacity: 0.08,
      dashArray: '4, 6',
      interactive: false,
    }).addTo(map));

    return () => {
      circlesRef.current.forEach((c) => c.remove());
      circlesRef.current = [];
    };
    // `sig` captures every input that changes the drawing; `centers`
    // itself is a fresh array on each parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, sig]);
}
