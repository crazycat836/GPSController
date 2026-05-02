import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';

const TILE_RETRY_DELAY_MS = 450;

// Neutral placeholder (warm gray 256x256 SVG) for tiles that ultimately
// fail to load. Without it, the dark .leaflet-container background bleeds
// through failed <img> slots as solid black squares.
const TILE_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d4d0c8"/></svg>'
);

const BASE_TILE_OPTS: L.TileLayerOptions = {
  updateWhenIdle: false,
  updateWhenZooming: true,
  keepBuffer: 4,
  crossOrigin: true,
  errorTileUrl: TILE_PLACEHOLDER,
};

function buildLayers(): Record<string, L.TileLayer> {
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
  // Use maxNativeZoom to cap real tile requests at each host's supported
  // zoom, while letting Leaflet upscale those tiles past that cap.
  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: 'abc',
    maxNativeZoom: 19,
    maxZoom: 21,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ...BASE_TILE_OPTS,
  });
  const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxNativeZoom: 20,
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    ...BASE_TILE_OPTS,
  });
  const esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19,
    maxZoom: 21,
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    ...BASE_TILE_OPTS,
  });
  return { osm: osmLayer, carto: cartoLayer, esri: esriLayer };
}

// Transient failures at high zoom (OSM 418/429 on rate limits, CDN cache
// misses, flaky network) are common. Retry each failed tile once with a
// cache-busted URL; if that also fails, Leaflet renders TILE_PLACEHOLDER.
function attachTileRetry(layer: L.TileLayer): void {
  layer.on('tileerror', (e: L.TileErrorEvent) => {
    const img = e.tile as HTMLImageElement | undefined;
    const coords = e.coords;
    if (!img || !coords || img.dataset.retried === '1') return;
    img.dataset.retried = '1';
    const url = layer.getTileUrl(coords);
    if (!url) return;
    const sep = url.includes('?') ? '&' : '?';
    setTimeout(() => { img.src = `${url}${sep}_r=${Date.now()}`; }, TILE_RETRY_DELAY_MS);
  });
}

/**
 * Owns the tile-layer registry and the swap that runs when `layerKey`
 * changes. The map itself must be created upstream before this hook
 * fires; the registry is built lazily on the first run that finds
 * `mapRef.current` populated, which prevents a registry-empty race.
 */
export function useMapTiles(
  mapRef: RefObject<L.Map | null>,
  layerKey: string,
): void {
  const layersRef = useRef<Record<string, L.TileLayer>>({});

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (Object.keys(layersRef.current).length === 0) {
      const layers = buildLayers();
      Object.values(layers).forEach(attachTileRetry);
      layersRef.current = layers;
    }

    const layers = layersRef.current;
    Object.values(layers).forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
    const key = layerKey ?? 'osm';
    (layers[key] ?? layers.osm).addTo(map);
  }, [mapRef, layerKey]);
}
