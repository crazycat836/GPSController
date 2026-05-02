import type L from 'leaflet';

/**
 * Typed view of Leaflet's private control-corner registry. Leaflet exposes
 * `_controlCorners` only on the runtime instance — its public d.ts omits it.
 * Keep this list MINIMAL: only the corners we actually nudge below the
 * FloatingPanel during map init.
 */
export type LeafletMapInternal = L.Map & {
  _controlCorners?: {
    topleft?: HTMLElement;
    topright?: HTMLElement;
    bottomleft?: HTMLElement;
    bottomright?: HTMLElement;
  };
};

export interface Position {
  lat: number;
  lng: number;
}

export interface Waypoint {
  lat: number;
  lng: number;
  index: number;
}
