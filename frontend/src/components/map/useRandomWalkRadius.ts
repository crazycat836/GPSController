import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { DEVICE_COLORS_HEX } from '../../lib/constants';
import type { Position } from './types';

/**
 * Owns the dashed radius circle that visualises the random-walk
 * containment area. Drawn only when both a positive radius and a
 * current position are available; removed otherwise.
 */
export function useRandomWalkRadius(
  mapRef: RefObject<L.Map | null>,
  randomWalkRadius: number | null,
  currentPosition: Position | null,
): void {
  const circleRef = useRef<L.Circle | null>(null);

  const lat = currentPosition?.lat;
  const lng = currentPosition?.lng;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visible = randomWalkRadius != null && randomWalkRadius > 0 && lat != null && lng != null;

    if (!visible) {
      if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
      return;
    }

    if (circleRef.current) {
      circleRef.current.setLatLng([lat, lng]);
      circleRef.current.setRadius(randomWalkRadius);
      return;
    }

    circleRef.current = L.circle([lat, lng], {
      radius: randomWalkRadius,
      color: DEVICE_COLORS_HEX[0],
      weight: 2,
      opacity: 0.6,
      fillColor: DEVICE_COLORS_HEX[0],
      fillOpacity: 0.08,
      dashArray: '6, 6',
    }).addTo(map);

    return () => {
      circleRef.current?.remove();
      circleRef.current = null;
    };
  }, [mapRef, randomWalkRadius, lat, lng]);
}
