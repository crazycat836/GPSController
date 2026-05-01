import { useRef, useEffect, useState, useCallback } from 'react';
import { useT } from '../i18n';
import { getInitialPosition } from '../services/api';
import { MARKER_HEX, ACCENT_HEX, DEVICE_COLORS_HEX } from '../lib/constants';
import L from 'leaflet';
import MapControls from './shell/MapControls';
import MapContextMenu, { type ContextMenuState } from './MapContextMenu';

// Typed view of Leaflet's private control-corner registry. Leaflet exposes
// `_controlCorners` only on the runtime instance — its public d.ts omits it.
// Keep this list MINIMAL: only the corners we actually nudge below the
// FloatingPanel during map init.
type LeafletMapInternal = L.Map & {
  _controlCorners?: {
    topleft?: HTMLElement;
    topright?: HTMLElement;
    bottomleft?: HTMLElement;
    bottomright?: HTMLElement;
  };
};

interface Position {
  lat: number;
  lng: number;
}

interface Waypoint {
  lat: number;
  lng: number;
  index: number;
}

interface MapViewProps {
  currentPosition: Position | null;
  /** When true, renders the current-position pin in a "cached / not yet live"
   *  style (dashed outline, no pulse, no glow). Set while the frontend has
   *  rehydrated a last-known position from persisted settings but the
   *  backend engine has not yet been told about it this session. */
  currentPositionUnsynced?: boolean;
  destination: Position | null;
  waypoints: Waypoint[];
  routePath: Position[];
  randomWalkRadius: number | null;
  onMapClick: (lat: number, lng: number) => void;
  onTeleport: (lat: number, lng: number) => void;
  onNavigate: (lat: number, lng: number) => void;
  onAddBookmark: (lat: number, lng: number) => void;
  onAddWaypoint?: (lat: number, lng: number) => void;
  showWaypointOption?: boolean;
  deviceConnected?: boolean;
  onShowToast?: (msg: string) => void;
  layerKey?: string;
  onLayerChange?: (key: string) => void;
  /** Fires once after Leaflet initializes so parents can drive imperative
   *  camera moves (fly-to, setView) without owning the instance. Called
   *  with null on unmount. */
  onMapReady?: (map: L.Map | null) => void;
  /** Physical PC geolocation pin — rendered as an amber dot with a pulsing
   *  halo so the user can see where the host computer actually is. Stays
   *  on the map until explicitly cleared (e.g. by "Refresh" in the Locate
   *  PC popover). Null/undefined removes the marker. */
  pcPosition?: Position | null;
}

function MapView({
  currentPosition,
  currentPositionUnsynced = false,
  destination,
  waypoints,
  routePath,
  randomWalkRadius,
  onMapClick,
  onTeleport,
  onNavigate,
  onAddBookmark,
  onAddWaypoint,
  showWaypointOption,
  deviceConnected = true,
  onShowToast,
  layerKey = 'osm',
  onLayerChange,
  onMapReady,
  pcPosition,
}: MapViewProps) {
  const t = useT();
  // onMapClick closure gets captured by the once-per-mount click handler;
  // route through a ref so toggling the prop mid-session takes effect.
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  // The map-init useEffect only runs once, so its click handler captures the
  // first-render `t`. Language switches then don't reach the tooltip hint.
  // Route lookups through a ref that we keep in sync every render.
  const tRef = useRef(t);
  tRef.current = t;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Stores an `L.Marker` (not a CircleMarker) — the current-position pin is
  // a div-icon marker (see the `L.marker(...)` call below), so we need the
  // marker-specific API (setIcon, setLatLng) without `as any` bandaids.
  const currentMarkerRef = useRef<L.Marker | null>(null);
  const prevPositionRef = useRef<Position | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  const pcMarkerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  // clickMarkerRef removed — left-click no longer drops a pin.
  const radiusCircleRef = useRef<L.Circle | null>(null);

  const layerMapRef = useRef<Record<string, L.TileLayer>>({});

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    lat: 0,
    lng: 0,
  });

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  // React to layerKey prop changes from SettingsMenu
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layers = layerMapRef.current;
    if (Object.keys(layers).length === 0) return;
    Object.values(layers).forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
    const key = layerKey ?? 'osm';
    if (layers[key]) layers[key].addTo(map);
  }, [layerKey]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [25.033, 121.5654],
      zoom: 13,
      zoomSnap: 1,
      wheelPxPerZoomLevel: 120,
      wheelDebounceTime: 60,
      // Keep Leaflet's default control off so we can position our own
      // zoom control below the EtaBar on the left (default top-left
      // would collide with the overlay).
      zoomControl: false,
    });
    // Nudge the whole topleft control cluster down below the FloatingPanel
    // (panel sits at top ~56px, ~320px tall max). Position below panel area.
    const mapInternal = map as LeafletMapInternal;
    const topLeftEl = mapInternal._controlCorners?.topleft;
    if (topLeftEl) {
      topLeftEl.style.marginTop = '56px';
      topLeftEl.style.marginLeft = '0px';
    }
    const topRightEl = mapInternal._controlCorners?.topright;
    if (topRightEl) {
      topRightEl.style.marginTop = '56px';
    }

    // Tile layers — three base maps with localStorage persistence.
    // Electron main hooks a compliant User-Agent for tile hosts
    // (see electron/main.js), otherwise tile.osm.org returns HTTP 418.
    // NOTE: do NOT enable `detectRetina` here. On retina displays Leaflet
    // bumps the tile URL zoom by +1 (via zoomOffset), which is applied
    // AFTER `maxNativeZoom` clamping — so OSM (max z=19) ends up requesting
    // z=20 at any display zoom past 18, all 404, and the dark container
    // background (#0f1117) shows through as a fully black map. CARTO's
    // `{r}` URL placeholder already handles retina via @2x tiles without
    // this side effect.
    // Neutral placeholder (warm gray 256x256 SVG) for tiles that ultimately
    // fail to load. Without it, the dark .leaflet-container background bleeds
    // through failed <img> slots as solid black squares.
    const TILE_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d4d0c8"/></svg>'
    );
    const baseOpts: L.TileLayerOptions = {
      updateWhenIdle: false,
      updateWhenZooming: true,
      keepBuffer: 4,
      crossOrigin: true,
      errorTileUrl: TILE_PLACEHOLDER,
    };
    // Use maxNativeZoom to cap real tile requests at each host's supported
    // zoom, while letting Leaflet upscale those tiles past that cap. This
    // prevents black/missing tiles at extreme zoom where servers 404 — the
    // .leaflet-container dark background (#0f1117) would otherwise bleed
    // through as solid black squares.
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc',
      maxNativeZoom: 19,
      maxZoom: 21,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      ...baseOpts,
    });
    const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxNativeZoom: 20,
      maxZoom: 22,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      ...baseOpts,
    });
    const esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19,
      maxZoom: 21,
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
      ...baseOpts,
    });

    const layers: Record<string, L.TileLayer> = { osm: osmLayer, carto: cartoLayer, esri: esriLayer };
    layerMapRef.current = layers;

    // Transient failures at high zoom (OSM 418/429 on rate limits, CDN cache
    // misses, flaky network) are common. Retry each failed tile once with a
    // cache-busted URL; if that also fails, Leaflet renders TILE_PLACEHOLDER.
    const attachTileRetry = (layer: L.TileLayer) => {
      layer.on('tileerror', (e: L.TileErrorEvent) => {
        const img = e.tile as HTMLImageElement | undefined;
        const coords = e.coords;
        if (!img || !coords || img.dataset.retried === '1') return;
        img.dataset.retried = '1';
        const url = layer.getTileUrl(coords);
        if (!url) return;
        const sep = url.includes('?') ? '&' : '?';
        setTimeout(() => { img.src = `${url}${sep}_r=${Date.now()}`; }, 450);
      });
    };
    attachTileRetry(osmLayer);
    attachTileRetry(cartoLayer);
    attachTileRetry(esriLayer);

    const activeLayer = layers[layerKey] || osmLayer;
    activeLayer.addTo(map);

    // Left-click on the map dismisses any open context menu.
    // If the parent wires `onMapClick` (currently used by the "left-click
    // to add waypoint" toggle in Loop / MultiStop modes), forward the
    // coordinates there too.
    map.on('click', (e: L.LeafletMouseEvent) => {
      closeContextMenu();
      try {
        onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
      } catch { /* ignore handler errors */ }
    });

    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      setContextMenu({
        visible: true,
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        lat: e.latlng.lat,
        lng: e.latlng.lng,
      });
    });

    mapRef.current = map;
    onMapReady?.(map);

    // Ensure the map fills its container after layout settles and on resize.
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (mapContainerRef.current) ro.observe(mapContainerRef.current);

    // Fetch the user-saved initial position from the backend (once, on mount).
    // If set, pan the map to it. Brief Taipei flash is acceptable.
    getInitialPosition().then(({ position }) => {
      if (!position || !mapRef.current) return;
      if (prevPositionRef.current) return; // a real device position already arrived
      mapRef.current.setView([position.lat, position.lng], mapRef.current.getZoom());
    }).catch(() => { /* default center stays */ });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      onMapReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update current position marker — move existing marker instead of recreating.
  // When currentPosition becomes null (e.g. after Settings → 清除虛擬定位) remove the marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!currentPosition) {
      if (currentMarkerRef.current) {
        try { currentMarkerRef.current.remove(); } catch { /* ignore */ }
        currentMarkerRef.current = null;
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

    if (currentMarkerRef.current) {
      currentMarkerRef.current.setLatLng(latlng);
      // Swap the icon so the pin reflects the current synced/unsynced state
      // without recreating the Leaflet marker (preserves tooltip binding).
      currentMarkerRef.current.setIcon(icon);
      currentMarkerRef.current.setTooltipContent(
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

      currentMarkerRef.current = marker;
    }

    // Only auto-center on first position or teleport (large jump > 500m)
    const prev = prevPositionRef.current;
    if (!prev) {
      map.setView(latlng, map.getZoom());
    } else {
      const dlat = (currentPosition.lat - prev.lat) * 111320;
      const dlng = (currentPosition.lng - prev.lng) * 111320 * Math.cos(currentPosition.lat * Math.PI / 180);
      const distM = Math.sqrt(dlat * dlat + dlng * dlng);
      if (distM > 500) {
        map.setView(latlng, map.getZoom());
      }
    }
    prevPositionRef.current = currentPosition;
  }, [currentPosition, currentPositionUnsynced]);

  // PC geolocation marker — separate from the virtual GPS avatar. Added /
  // updated / removed in response to the LocatePcButton feature so users
  // can see where their host computer actually is on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pcPosition) {
      if (pcMarkerRef.current) {
        try { pcMarkerRef.current.remove(); } catch { /* ignore */ }
        pcMarkerRef.current = null;
      }
      return;
    }

    const latlng: L.LatLngExpression = [pcPosition.lat, pcPosition.lng];
    const tooltip = `${pcPosition.lat.toFixed(6)}, ${pcPosition.lng.toFixed(6)}`;

    if (pcMarkerRef.current) {
      pcMarkerRef.current.setLatLng(latlng);
      pcMarkerRef.current.setTooltipContent(tooltip);
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
    pcMarkerRef.current = marker;
  }, [pcPosition]);

  // Update destination marker
  const destSigRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sig = destination ? `${destination.lat.toFixed(7)},${destination.lng.toFixed(7)}` : null;
    if (sig === destSigRef.current) return;
    destSigRef.current = sig;

    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }

    if (destination) {
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

      const marker = L.marker([destination.lat, destination.lng], {
        icon,
      }).addTo(map);

      marker.bindTooltip(t('map.destination'), { direction: 'top', offset: [0, -38] });
      destMarkerRef.current = marker;
    }
  }, [destination]);

  // Update waypoint markers
  const waypointSigRef = useRef<string>('');
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sig = waypoints.map((w) => `${w.lat.toFixed(7)},${w.lng.toFixed(7)}`).join('|');
    if (sig === waypointSigRef.current) return;
    waypointSigRef.current = sig;

    waypointMarkersRef.current.forEach((m) => m.remove());
    waypointMarkersRef.current = [];

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
      waypointMarkersRef.current.push(marker);
    });
  }, [waypoints]);

  // Route polyline: base solid line + overlay white dashed line with a CSS
  // stroke-dashoffset animation, giving the subtle "flowing arrow" look
  // that locwarp ships in v0.2.48.
  const polylineOverlayRef = useRef<L.Polyline | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }
    if (polylineOverlayRef.current) {
      polylineOverlayRef.current.remove();
      polylineOverlayRef.current = null;
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
      polylineRef.current = glow;
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
      polylineOverlayRef.current = main;
    }
  }, [routePath]);

  // Update random walk radius circle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old circle
    if (radiusCircleRef.current) {
      radiusCircleRef.current.remove();
      radiusCircleRef.current = null;
    }

    // Draw circle when radius is set and we have a position
    if (randomWalkRadius && randomWalkRadius > 0 && currentPosition) {
      const circle = L.circle(
        [currentPosition.lat, currentPosition.lng],
        {
          radius: randomWalkRadius,
          color: DEVICE_COLORS_HEX[0],
          weight: 2,
          opacity: 0.6,
          fillColor: DEVICE_COLORS_HEX[0],
          fillOpacity: 0.08,
          dashArray: '6, 6',
        }
      ).addTo(map);
      radiusCircleRef.current = circle;
    }
  }, [randomWalkRadius, currentPosition]);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map || !currentPosition) return;
    map.setView([currentPosition.lat, currentPosition.lng], Math.max(map.getZoom(), 16), {
      animate: true,
    });
  }, [currentPosition]);

  return (
    <div className="map-container" style={{ position: 'relative', flex: 1 }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      <MapControls
        onRecenter={recenter}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        canRecenter={!!currentPosition}
        className="absolute bottom-10 right-3 z-[var(--z-map-ui)]"
      />

      <MapContextMenu
        state={contextMenu}
        onClose={closeContextMenu}
        onTeleport={onTeleport}
        onNavigate={onNavigate}
        onAddBookmark={onAddBookmark}
        onAddWaypoint={onAddWaypoint}
        showWaypointOption={showWaypointOption}
        deviceConnected={deviceConnected}
        onShowToast={onShowToast}
      />
    </div>
  );
}

export default MapView;
