import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useT } from '../i18n';
import { getInitialPosition, reverseGeocode } from '../services/api';
import { MARKER_HEX, ACCENT_HEX, DEVICE_COLORS_HEX } from '../lib/constants';
import L from 'leaflet';

interface Position {
  lat: number;
  lng: number;
}

interface Waypoint {
  lat: number;
  lng: number;
  index: number;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

interface WhatsHereState {
  loading: boolean;
  label: string;
  address: string;
  error: boolean;
}

const WHATS_HERE_IDLE: WhatsHereState = { loading: false, label: '', address: '', error: false };

import type { DeviceRuntime, RuntimesMap } from '../hooks/useSimulation';
import type { DeviceInfo } from '../hooks/useDevice';

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
  // Group mode: when runtimes + devices are present and 2+ devices connected,
  // render per-device markers/polylines/circles. Single-device rendering is
  // still driven by the legacy currentPosition/destination/routePath props.
  runtimes?: RuntimesMap;
  devices?: DeviceInfo[];
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

// Leaflet requires raw hex — CSS variables don't work in SVG marker innerHTML.
// Keep in sync with --color-device-a / --color-device-b in index.css @theme.
import { DEVICE_COLORS_HEX as DEVICE_COLORS, DEVICE_LETTERS } from '../lib/constants';
import { haversineM } from '../lib/geo';
import MapControls from './shell/MapControls';

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
  runtimes,
  devices,
  onMapReady,
  pcPosition,
}: MapViewProps) {
  // Dual-mode rendering disabled by design: with pre-sync (both devices
  // teleport to the same start before any group action) and shared random
  // seed, the two phones always sit at the exact same coordinate, so two
  // markers and two polylines just overlap and add visual noise. We keep
  // the dual data plumbing (devices, runtimes) for the dual cleanup effect
  // below but always render the single-device view (driven by the primary
  // device's currentPosition / routePath / destination passed in as props).
  const dualMode = false;
  // Suppress unused-prop warnings — kept for API compatibility and the
  // dual-marker cleanup effect that wipes any residual dual markers if a
  // user upgrades from an earlier 0.2.0 build that had them rendered.
  void devices; void runtimes;
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
  const currentMarkerRef = useRef<L.CircleMarker | null>(null);
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
  // Measured-and-clamped menu position. Null while the menu is hidden or
  // before useLayoutEffect has run once; the menu is rendered invisibly on
  // first frame to measure, then re-rendered at the clamped position.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [whatsHere, setWhatsHere] = useState<WhatsHereState>(WHATS_HERE_IDLE);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
    setMenuPos(null);
    setWhatsHere(WHATS_HERE_IDLE);
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
    const topLeftEl = (map as any)._controlCorners?.topleft as HTMLElement | undefined;
    if (topLeftEl) {
      topLeftEl.style.marginTop = '56px';
      topLeftEl.style.marginLeft = '0px';
    }
    const topRightEl = (map as any)._controlCorners?.topright as HTMLElement | undefined;
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
    if (dualMode) {
      // Dual-mode renderer below owns current-position markers; clear any
      // legacy single-device marker so it doesn't duplicate.
      if (currentMarkerRef.current) {
        try { (currentMarkerRef.current as any).remove(); } catch { /* ignore */ }
        currentMarkerRef.current = null;
      }
      // Pan the map to the new currentPosition in dual mode as well (address
      // search / coord input / bookmark click sets currentPosition before the
      // backend position_update arrives). First jump always centers; after
      // that only re-center on large jumps (>500m).
      if (currentPosition) {
        const latlng: L.LatLngExpression = [currentPosition.lat, currentPosition.lng];
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
      } else {
        prevPositionRef.current = null;
      }
      return;
    }
    if (!currentPosition) {
      if (currentMarkerRef.current) {
        try { (currentMarkerRef.current as any).remove(); } catch { /* ignore */ }
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
      (currentMarkerRef.current as any).setLatLng(latlng);
      // Swap the icon so the pin reflects the current synced/unsynced state
      // without recreating the Leaflet marker (preserves tooltip binding).
      (currentMarkerRef.current as any).setIcon(icon);
      (currentMarkerRef.current as any).setTooltipContent(
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

      currentMarkerRef.current = marker as any;
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
  }, [currentPosition, currentPositionUnsynced, dualMode]);

  // PC geolocation marker — separate from the virtual GPS avatar. Added /
  // updated / removed in response to the LocatePcButton feature so users
  // can see where their host computer actually is on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pcPosition) {
      if (pcMarkerRef.current) {
        try { (pcMarkerRef.current as any).remove(); } catch { /* ignore */ }
        pcMarkerRef.current = null;
      }
      return;
    }

    const latlng: L.LatLngExpression = [pcPosition.lat, pcPosition.lng];
    const tooltip = `${pcPosition.lat.toFixed(6)}, ${pcPosition.lng.toFixed(6)}`;

    if (pcMarkerRef.current) {
      (pcMarkerRef.current as any).setLatLng(latlng);
      (pcMarkerRef.current as any).setTooltipContent(tooltip);
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
    if (dualMode) {
      if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }
      destSigRef.current = null;
      return;
    }

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
  }, [destination, dualMode]);

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

    if (dualMode) return;

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
  }, [routePath, dualMode]);

  // Update random walk radius circle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old circle
    if (radiusCircleRef.current) {
      radiusCircleRef.current.remove();
      radiusCircleRef.current = null;
    }

    if (dualMode) return;

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
  }, [randomWalkRadius, currentPosition, dualMode]);

  // ── Dual-mode per-device overlays ────────────────────────────────────
  // Keeps refs for markers/polylines/circles keyed by udid so updates don't
  // recreate Leaflet layers on every position tick.
  const deviceMarkersRef = useRef<Record<string, L.Marker>>({});
  const deviceDestMarkersRef = useRef<Record<string, L.Marker>>({});
  const deviceDestSharedRef = useRef<L.Marker | null>(null);
  const devicePolylinesRef = useRef<Record<string, L.Polyline>>({});
  const deviceCirclesRef = useRef<Record<string, L.Circle>>({});

  const clearDeviceOverlays = () => {
    Object.values(deviceMarkersRef.current).forEach((m) => { try { m.remove(); } catch { /* ignore */ } });
    deviceMarkersRef.current = {};
    Object.values(deviceDestMarkersRef.current).forEach((m) => { try { m.remove(); } catch { /* ignore */ } });
    deviceDestMarkersRef.current = {};
    if (deviceDestSharedRef.current) {
      try { deviceDestSharedRef.current.remove(); } catch { /* ignore */ }
      deviceDestSharedRef.current = null;
    }
    Object.values(devicePolylinesRef.current).forEach((p) => { try { p.remove(); } catch { /* ignore */ } });
    devicePolylinesRef.current = {};
    Object.values(deviceCirclesRef.current).forEach((c) => { try { c.remove(); } catch { /* ignore */ } });
    deviceCirclesRef.current = {};
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!dualMode || !devices || !runtimes) {
      clearDeviceOverlays();
      return;
    }

    const activeUdids = new Set<string>();
    devices.slice(0, 2).forEach((dev, i) => {
      const rt: DeviceRuntime | undefined = runtimes[dev.udid];
      if (!rt) return;
      activeUdids.add(dev.udid);
      const color = DEVICE_COLORS[i];
      const letter = DEVICE_LETTERS[i];

      // Current position marker
      if (rt.currentPos) {
        const latlng: L.LatLngExpression = [rt.currentPos.lat, rt.currentPos.lng];
        const existing = deviceMarkersRef.current[dev.udid];
        if (existing) {
          (existing as any).setLatLng(latlng);
        } else {
          // Dual-mode letter badge — no pulse ring (single-device pin owns
          // the pulse language; dual mode needs two distinguishable dots).
          const icon = L.divIcon({
            className: 'current-pos-marker',
            html: `<svg width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="13" fill="${color}" opacity="0.95"/>
              <circle cx="22" cy="22" r="11" fill="none" stroke="#ffffff" stroke-width="2"/>
              <text x="22" y="26" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="600" font-family="system-ui">${letter}</text>
            </svg>`,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          });
          const marker = L.marker(latlng, { icon, zIndexOffset: 1000 + i }).addTo(map);
          marker.bindTooltip(`${letter} · ${dev.name}`, { direction: 'top', offset: [0, -20] });
          deviceMarkersRef.current[dev.udid] = marker;
        }
      } else if (deviceMarkersRef.current[dev.udid]) {
        try { deviceMarkersRef.current[dev.udid].remove(); } catch { /* ignore */ }
        delete deviceMarkersRef.current[dev.udid];
      }

      // Route polyline
      const existingLine = devicePolylinesRef.current[dev.udid];
      if (existingLine) {
        try { existingLine.remove(); } catch { /* ignore */ }
        delete devicePolylinesRef.current[dev.udid];
      }
      if (rt.routePath && rt.routePath.length > 1) {
        const latlngs: L.LatLngExpression[] = rt.routePath.map((p) => [p.lat, p.lng]);
        const line = L.polyline(latlngs, { color, weight: 4, opacity: 0.85 }).addTo(map);
        devicePolylinesRef.current[dev.udid] = line;
      }

      // Random-walk radius circle
      const existingCircle = deviceCirclesRef.current[dev.udid];
      if (existingCircle) {
        try { existingCircle.remove(); } catch { /* ignore */ }
        delete deviceCirclesRef.current[dev.udid];
      }
      if (randomWalkRadius && randomWalkRadius > 0 && rt.currentPos) {
        const c = L.circle([rt.currentPos.lat, rt.currentPos.lng], {
          radius: randomWalkRadius,
          color, weight: 2, opacity: 0.7,
          fillColor: color, fillOpacity: 0.06,
          dashArray: '6, 6',
        }).addTo(map);
        deviceCirclesRef.current[dev.udid] = c;
      }
    });

    // Remove layers for devices no longer in the slice
    Object.keys(deviceMarkersRef.current).forEach((u) => {
      if (!activeUdids.has(u)) {
        try { deviceMarkersRef.current[u].remove(); } catch { /* ignore */ }
        delete deviceMarkersRef.current[u];
      }
    });
    Object.keys(devicePolylinesRef.current).forEach((u) => {
      if (!activeUdids.has(u)) {
        try { devicePolylinesRef.current[u].remove(); } catch { /* ignore */ }
        delete devicePolylinesRef.current[u];
      }
    });
    Object.keys(deviceCirclesRef.current).forEach((u) => {
      if (!activeUdids.has(u)) {
        try { deviceCirclesRef.current[u].remove(); } catch { /* ignore */ }
        delete deviceCirclesRef.current[u];
      }
    });

    // Destination markers: dedup when both destinations are within ~5m.
    Object.values(deviceDestMarkersRef.current).forEach((m) => { try { m.remove(); } catch { /* ignore */ } });
    deviceDestMarkersRef.current = {};
    if (deviceDestSharedRef.current) {
      try { deviceDestSharedRef.current.remove(); } catch { /* ignore */ }
      deviceDestSharedRef.current = null;
    }

    const dests: { dev: DeviceInfo; color: string; letter: string; dest: Position }[] = [];
    devices.slice(0, 2).forEach((dev, i) => {
      const rt = runtimes[dev.udid];
      if (rt && rt.destination) {
        dests.push({ dev, color: DEVICE_COLORS[i], letter: DEVICE_LETTERS[i], dest: rt.destination });
      }
    });

    const allSame = dests.length >= 2 && dests.slice(1).every((d) => haversineM(d.dest, dests[0].dest) <= 5);
    if (dests.length === 0) {
      // nothing to draw
    } else if (allSame) {
      const d = dests[0].dest;
      const redIcon = L.divIcon({
        className: 'dest-marker',
        html: `<svg width="36" height="50" viewBox="0 0 36 50">
          <ellipse cx="18" cy="47" rx="6" ry="2" fill="#000" opacity="0.2"/>
          <path d="M18 2C9.7 2 3 8.7 3 17c0 12 15 30 15 30s15-18 15-30C33 8.7 26.3 2 18 2z" fill="#e53935"/>
          <circle cx="18" cy="17" r="7" fill="#ffffff" opacity="0.95"/>
        </svg>`,
        iconSize: [36, 50],
        iconAnchor: [18, 47],
      });
      const m = L.marker([d.lat, d.lng], { icon: redIcon }).addTo(map);
      m.bindTooltip(t('map.destination'), { direction: 'top', offset: [0, -48] });
      deviceDestSharedRef.current = m;
    } else {
      dests.forEach(({ dev, color, letter, dest }) => {
        const icon = L.divIcon({
          className: 'dest-marker',
          html: `<svg width="36" height="50" viewBox="0 0 36 50">
            <ellipse cx="18" cy="47" rx="6" ry="2" fill="#000" opacity="0.2"/>
            <path d="M18 2C9.7 2 3 8.7 3 17c0 12 15 30 15 30s15-18 15-30C33 8.7 26.3 2 18 2z" fill="${color}"/>
            <circle cx="18" cy="17" r="7" fill="#ffffff" opacity="0.95"/>
            <text x="18" y="21" text-anchor="middle" fill="${color}" font-size="11" font-weight="600" font-family="system-ui">${letter}</text>
          </svg>`,
          iconSize: [36, 50],
          iconAnchor: [18, 47],
        });
        const m = L.marker([dest.lat, dest.lng], { icon }).addTo(map);
        m.bindTooltip(`${letter} · ${t('map.destination')}`, { direction: 'top', offset: [0, -48] });
        deviceDestMarkersRef.current[dev.udid] = m;
      });
    }
  }, [dualMode, devices, runtimes, randomWalkRadius, t]);

  // Close context menu on outside click
  useEffect(() => {
    const handler = () => closeContextMenu();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [closeContextMenu]);

  // Clamp the context menu to the viewport. Running in useLayoutEffect lets
  // us measure the real DOM before the browser paints, so the menu doesn't
  // visibly flash in the clipped position before jumping back in-bounds.
  useLayoutEffect(() => {
    if (!contextMenu.visible) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const maxLeft = window.innerWidth - rect.width - pad;
    const maxTop = window.innerHeight - rect.height - pad;
    const left = Math.max(pad, Math.min(contextMenu.x, maxLeft));
    const top = Math.max(pad, Math.min(contextMenu.y, maxTop));
    setMenuPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    // Re-measure when the "What's here" panel expands/collapses — its
    // content changes the menu's height so we need to re-clamp. whatsHere
    // is referenced so the effect re-runs on every transition.
  }, [contextMenu.visible, contextMenu.x, contextMenu.y, whatsHere.loading, whatsHere.label, whatsHere.address, whatsHere.error]);

  const handleWhatsHere = useCallback(async () => {
    const lat = contextMenu.lat;
    const lng = contextMenu.lng;
    setWhatsHere({ loading: true, label: '', address: '', error: false });
    try {
      const res = await reverseGeocode(lat, lng);
      if (!res) {
        setWhatsHere({ loading: false, label: '', address: '', error: true });
        return;
      }
      setWhatsHere({
        loading: false,
        label: res.place_name || res.display_name || '',
        address: res.display_name || '',
        error: false,
      });
    } catch {
      setWhatsHere({ loading: false, label: '', address: '', error: true });
    }
  }, [contextMenu.lat, contextMenu.lng]);

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

      {contextMenu.visible && (
        <div
          data-fc="map.context-menu"
          ref={contextMenuRef}
          className="context-menu anim-scale-in-tl"
          style={{
            position: 'fixed',
            // On first render we haven't measured yet; hide the menu so the
            // user doesn't see it flash at an out-of-bounds location before
            // useLayoutEffect clamps it. Once measured, render at clamped
            // position and make visible.
            left: menuPos?.left ?? contextMenu.x,
            top: menuPos?.top ?? contextMenu.y,
            visibility: menuPos ? 'visible' : 'hidden',
            zIndex: 'var(--z-dropdown)',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '4px 0',
            boxShadow: 'var(--shadow-lg)',
            minWidth: 180,
            maxWidth: 360,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 1. Coordinates label — clickable. Tapping it reverse-geocodes
                and expands the human-readable address inline underneath,
                so the user can sanity-check "where is this?" before
                choosing teleport / navigate. */}
          <button
            type="button"
            onClick={handleWhatsHere}
            disabled={whatsHere.loading}
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              width: '100%',
              padding: '8px 16px 6px',
              color: 'var(--color-accent-strong)',
              fontSize: 12,
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              userSelect: 'text',
              cursor: whatsHere.loading ? 'progress' : 'pointer',
            }}
            title={tRef.current('map.whats_here')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.7, flexShrink: 0 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>{contextMenu.lat.toFixed(6)}, {contextMenu.lng.toFixed(6)}</span>
          </button>
          {whatsHere.loading && (
            <div style={{ padding: '0 16px 6px', fontSize: 11, opacity: 0.7, fontStyle: 'italic' }}>
              {tRef.current('map.whats_here_loading')}
            </div>
          )}
          {!whatsHere.loading && whatsHere.error && (
            <div style={{ padding: '0 16px 6px', fontSize: 11, color: 'var(--color-danger)' }}>
              {tRef.current('map.whats_here_failed')}
            </div>
          )}
          {!whatsHere.loading && !whatsHere.error && whatsHere.label && (
            <div style={{ padding: '0 16px 6px', fontSize: 11, color: 'var(--color-text-1)' }}>
              <div style={{ fontWeight: 600 }}>{whatsHere.label}</div>
              {whatsHere.address && whatsHere.address !== whatsHere.label && (
                <div style={{ opacity: 0.7, marginTop: 2, lineHeight: 1.35 }}>{whatsHere.address}</div>
              )}
            </div>
          )}
          <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0 4px' }} />

          {/* 2 + 3. Teleport / Navigate (device-gated). */}
          {deviceConnected ? (
            <>
              <div
                className="context-menu-item"
                style={contextMenuItemStyle}
                onMouseEnter={highlightItem}
                onMouseLeave={unhighlightItem}
                onClick={() => {
                  onTeleport(contextMenu.lat, contextMenu.lng);
                  closeContextMenu();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
                {t('map.teleport_here')}
              </div>
              <div
                className="context-menu-item"
                style={contextMenuItemStyle}
                onMouseEnter={highlightItem}
                onMouseLeave={unhighlightItem}
                onClick={() => {
                  onNavigate(contextMenu.lat, contextMenu.lng);
                  closeContextMenu();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
                  <polygon points="3,11 22,2 13,21 11,13" />
                </svg>
                {t('map.navigate_here')}
              </div>
            </>
          ) : (
            <div
              style={{ ...contextMenuItemStyle, color: 'var(--color-danger-text)', cursor: 'not-allowed', opacity: 0.75 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              {t('map.device_disconnected')}
            </div>
          )}

          {/* 4. Copy coordinates to clipboard. */}
          <div
            className="context-menu-item"
            style={contextMenuItemStyle}
            onMouseEnter={highlightItem}
            onMouseLeave={unhighlightItem}
            onClick={async () => {
              const txt = `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`;
              try {
                await navigator.clipboard.writeText(txt);
              } catch {
                const ta = document.createElement('textarea');
                ta.value = txt;
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch { /* ignore */ }
                document.body.removeChild(ta);
              }
              if (onShowToast) onShowToast(tRef.current('map.coords_copied'));
              closeContextMenu();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            {t('map.copy_coords')}
          </div>

          {/* 5. Add to bookmarks. */}
          <div
            className="context-menu-item"
            style={contextMenuItemStyle}
            onMouseEnter={highlightItem}
            onMouseLeave={unhighlightItem}
            onClick={() => {
              onAddBookmark(contextMenu.lat, contextMenu.lng);
              closeContextMenu();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
            </svg>
            {t('map.add_bookmark')}
          </div>

          {/* 6. Add waypoint (only when in a route mode). */}
          {showWaypointOption && onAddWaypoint && (
            <>
              <div style={{ height: 1, background: 'var(--color-border-strong)', margin: '4px 0' }} />
              <div
                className="context-menu-item"
                style={contextMenuItemStyle}
                onMouseEnter={highlightItem}
                onMouseLeave={unhighlightItem}
                onClick={() => {
                  onAddWaypoint(contextMenu.lat, contextMenu.lng);
                  closeContextMenu();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="5" x2="12" y2="1" />
                  <line x1="12" y1="23" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="1" y2="12" />
                  <line x1="23" y1="12" x2="19" y2="12" />
                </svg>
                {t('map.add_waypoint')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const contextMenuItemStyle: React.CSSProperties = {
  padding: '8px 16px',
  cursor: 'pointer',
  color: 'var(--color-text-1)',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  transition: 'background 0.15s',
};

function highlightItem(e: React.MouseEvent<HTMLDivElement>) {
  (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface-hover)';
}

function unhighlightItem(e: React.MouseEvent<HTMLDivElement>) {
  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
}

export default MapView;
