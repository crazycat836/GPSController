import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { haversineM } from '../../lib/geo';
import type { Position } from './types';

/**
 * Min jump distance (m) between two consecutive `currentPosition` updates
 * that triggers the camera to re-centre. Below this we keep the user's
 * pan/zoom intact — only teleports / large drifts grab focus.
 */
const AUTO_RECENTER_THRESHOLD_M = 500;

/**
 * Owns the lifecycle of the current-position div-icon marker plus the
 * auto-recenter behaviour. Recreates the icon (not the marker) when the
 * synced/unsynced state flips so tooltip bindings survive.
 *
 * Returns the prev-position ref so callers (the initial-position fetcher
 * inside the map-init effect) can detect whether a real device fix has
 * already arrived before applying their fallback view.
 */
export function useCurrentPositionMarker(
  mapRef: RefObject<L.Map | null>,
  currentPosition: Position | null,
  currentPositionUnsynced: boolean,
): RefObject<Position | null> {
  const markerRef = useRef<L.Marker | null>(null);
  const prevPositionRef = useRef<Position | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!currentPosition) {
      if (markerRef.current) {
        try { markerRef.current.remove(); } catch { /* ignore */ }
        markerRef.current = null;
      }
      prevPositionRef.current = null;
      return;
    }

    const latlng: L.LatLngExpression = [currentPosition.lat, currentPosition.lng];

    const pinClasses = currentPositionUnsynced
      ? 'map-pin-current map-pin-current--unsynced'
      : 'map-pin-current';
    const icon = L.divIcon({
      className: 'current-pos-marker',
      html: `<div data-fc="map.position-marker" class="${pinClasses}"></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
      markerRef.current.setIcon(icon);
      markerRef.current.setTooltipContent(
        `${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`
      );
    } else {
      const marker = L.marker(latlng, {
        icon,
        zIndexOffset: 1000,
      }).addTo(map);

      marker.bindTooltip(
        `${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`,
        { direction: 'top', offset: [0, -20] }
      );

      markerRef.current = marker;
    }

    const prev = prevPositionRef.current;
    if (!prev || haversineM(prev, currentPosition) > AUTO_RECENTER_THRESHOLD_M) {
      map.setView(latlng, map.getZoom());
    }
    prevPositionRef.current = currentPosition;
  }, [mapRef, currentPosition, currentPositionUnsynced]);

  return prevPositionRef;
}
