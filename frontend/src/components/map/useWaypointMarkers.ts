import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { MARKER_HEX } from '../../lib/constants';
import type { StringKey } from '../../i18n';
import type { Waypoint } from './types';

type Translator = (key: StringKey, vars?: Record<string, string | number>) => string;

/**
 * Owns the lifecycle of the numbered subway-station waypoint markers.
 * Skips redundant rebuilds via a position-signature hash and routes the
 * translator through a ref so language switches between waypoint changes
 * don't fight the `[waypoints]`-deps effect (mirrors the orchestrator's
 * historic `tRef` pattern).
 */
export function useWaypointMarkers(
  mapRef: RefObject<L.Map | null>,
  waypoints: Waypoint[],
  t: Translator,
): void {
  const markersRef = useRef<L.Marker[]>([]);
  const sigRef = useRef<string>('');
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sig = waypoints.map((w) => `${w.lat.toFixed(7)},${w.lng.toFixed(7)}`).join('|');
    if (sig === sigRef.current) return;
    sigRef.current = sig;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    waypoints.forEach((wp) => {
      // index 0 is the implicit start point; show it as "S" in green so the
      // map matches the side panel ("起點 / Start"), and number the rest 1..N.
      const isStart = wp.index === 0;
      const label = isStart ? 'S' : String(wp.index);
      // Subway-station vocabulary: thick ring + solid inner + short
      // downward tail + soft ground shadow. Palette keeps the start/way
      // contrast but drops the heavy gradient pin body for a flatter,
      // more modern look.
      const ringFill = isStart ? MARKER_HEX.start : MARKER_HEX.end;
      const innerFill = isStart ? MARKER_HEX.startInner : MARKER_HEX.endInner;
      const textFill = '#ffffff';
      const wpIcon = L.divIcon({
        className: 'waypoint-marker waypoint-marker-subway',
        html: `<svg width="36" height="42" viewBox="0 0 36 42">
          <ellipse cx="18" cy="39" rx="8" ry="2" fill="#000" opacity="0.18"/>
          <path d="M18 24 L14 32 L22 32 Z" fill="${ringFill}" opacity="0.95"/>
          <circle cx="18" cy="16" r="14" fill="#ffffff" opacity="0.96"/>
          <circle cx="18" cy="16" r="14" fill="none" stroke="${ringFill}" stroke-width="4"/>
          <circle cx="18" cy="16" r="9" fill="${innerFill}"/>
          <text x="18" y="20" text-anchor="middle" fill="${textFill}" font-size="12" font-weight="600" font-family="system-ui">${label}</text>
        </svg>`,
        iconSize: [36, 42],
        iconAnchor: [18, 39],
      });

      const marker = L.marker([wp.lat, wp.lng], { icon: wpIcon }).addTo(map);
      marker.bindTooltip(
        isStart ? tRef.current('panel.waypoint_start') : tRef.current('panel.waypoint_num', { n: wp.index }),
        { direction: 'top', offset: [0, -14] },
      );
      markersRef.current.push(marker);
    });
  }, [mapRef, waypoints]);
}
