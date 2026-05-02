import { useRef, useEffect, useState, useCallback } from 'react';
import { useT } from '../i18n';
import { getInitialPosition } from '../services/api';
import { ACCENT_HEX, DEVICE_COLORS_HEX } from '../lib/constants';
import L from 'leaflet';
import MapControls from './shell/MapControls';
import MapContextMenu, { type ContextMenuState } from './MapContextMenu';
import type { LeafletMapInternal, Position, Waypoint } from './map/types';
import { useCurrentPositionMarker } from './map/useCurrentPositionMarker';
import { usePcMarker } from './map/usePcMarker';
import { useDestinationMarker } from './map/useDestinationMarker';
import { useWaypointMarkers } from './map/useWaypointMarkers';

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
  // onMapReady is invoked from both the init and the unmount-teardown
  // effect; routing through a ref means parents can re-render with a new
  // callback identity without retriggering either effect.
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => { onMapReadyRef.current = onMapReady; }, [onMapReady]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  // clickMarkerRef removed — left-click no longer drops a pin.
  const radiusCircleRef = useRef<L.Circle | null>(null);

  const layerMapRef = useRef<Record<string, L.TileLayer>>({});
  // Tracks the ResizeObserver created during first-mount init so the
  // map-owning effect's cleanup can tear it down — without needing the
  // observer in the effect's closure (which would fire teardown on
  // every layerKey change instead of unmount).
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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

  // Single effect that owns the Leaflet tile layer:
  //   - on first run, builds the map + control-corner offsets + the
  //     three-layer registry (gated on `!mapRef.current`);
  //   - on every run (first mount AND each `layerKey` change), removes
  //     any currently-attached registry layer and adds the one matching
  //     the current `layerKey`.
  //
  // Collapsing the previous "init + layerKey" effect pair eliminates the
  // race where the layerKey effect (declared first, runs first) bailed on
  // an empty registry during initial mount, while the `[]`-deps init
  // effect then read `layerKey` directly without re-subscribing — any
  // prop change between render and effect-flush was silently swallowed.
  //
  // Map+ResizeObserver teardown intentionally lives in a separate
  // `[]`-deps effect so it fires exactly once on unmount, not on every
  // layerKey change.
  useEffect(() => {
    if (!mapRef.current && mapContainerRef.current) {
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
      onMapReadyRef.current?.(map);

      // Ensure the map fills its container after layout settles and on resize.
      const ro = new ResizeObserver(() => {
        map.invalidateSize();
      });
      ro.observe(mapContainerRef.current);
      resizeObserverRef.current = ro;

      // Fetch the user-saved initial position from the backend (once, on mount).
      // If set, pan the map to it. Brief Taipei flash is acceptable.
      getInitialPosition().then(({ position }) => {
        if (!position || !mapRef.current) return;
        if (prevPositionRef.current) return; // a real device position already arrived
        mapRef.current.setView([position.lat, position.lng], mapRef.current.getZoom());
      }).catch(() => { /* default center stays */ });
    }

    // Layer swap — runs on first mount AND on every layerKey change.
    const map = mapRef.current;
    const layers = layerMapRef.current;
    if (map && Object.keys(layers).length > 0) {
      Object.values(layers).forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
      const key = layerKey ?? 'osm';
      (layers[key] ?? layers.osm).addTo(map);
    }
    // No cleanup here: layerKey-change reruns must not tear the map down.
    // True unmount teardown lives in the dedicated `[]`-deps effect below
    // so it fires exactly once when the component is being destroyed.
  }, [layerKey]);

  // Map teardown — separate from the layer-management effect so it fires
  // only on real unmount (not on every layerKey change). All dependencies
  // are refs, so this effect is genuinely empty-deps.
  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      onMapReadyRef.current?.(null);
    };
  }, []);

  const prevPositionRef = useCurrentPositionMarker(mapRef, currentPosition, currentPositionUnsynced);

  usePcMarker(mapRef, pcPosition);

  useDestinationMarker(mapRef, destination, t('map.destination'));

  useWaypointMarkers(mapRef, waypoints, t);

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
