/** Centralized localStorage key constants. */
export const STORAGE_KEYS = {
  lang: 'geomirage.lang',
  tileLayer: 'geomirage.tile_layer',
  straightLine: 'geomirage.straight_line',
  tunnelIp: 'geomirage.tunnel.ip',
  tunnelPort: 'geomirage.tunnel.port',
  pauseMultiStop: 'geomirage.pause.multi_stop',
  pauseLoop: 'geomirage.pause.loop',
  pauseRandomWalk: 'geomirage.pause.random_walk',
  updateDismissed: 'geomirage.update_check.dismissed',
  updateLastCheck: 'geomirage.update_check.last_check',
  avatarSelection: 'geomirage.avatar_selection',
  avatarCustom: 'geomirage.avatar_custom',
  // Whether the bottom simulation dock is collapsed to its header only.
  // Persisted so the panel stays out of the way of the map across reloads.
  dockCollapsed: 'geomirage.dock_collapsed',
  // Gold Ditto (拉金盆) anchor — user's real-world coordinate. JSON-
  // serialised ``{lat, lng}`` so absent / malformed entries decode to
  // null cleanly and the UI re-prompts.
  goldDittoAnchor: 'geomirage.gold_ditto.anchor',
  // Optional user-supplied Google Places API key. When set, the search box
  // routes through Google (better POI / business / fuzzy-name results);
  // otherwise it falls back to the keyless Photon provider. Stored locally
  // and forwarded only to the local backend, never to a third party.
  googlePlacesKey: 'geomirage.google_places_key',
  // Forward-geocoding provider the search box uses. One of
  // 'nominatim' | 'photon' | 'google'. Persisted so the user's choice
  // survives reloads; 'google' additionally requires `googlePlacesKey`.
  searchProvider: 'geomirage.search_provider',
  // Last-selected movement speed: JSON `{moveMode, customSpeedKmh,
  // speedMinKmh, speedMaxKmh}`. Persisted so the speed the user picked
  // is reused on the next launch instead of resetting to Walking.
  speedPrefs: 'geomirage.speed_prefs',
  // Flower-mode settings: JSON `FlowerSettings` (lib/flower.ts). Decoded
  // through `sanitizeFlowerSettings`, so stale / partial blobs are safe.
  flowerSettings: 'geomirage.flower_settings',
} as const

// Keys written before the rename to GeoMirage used this prefix; the suffix
// after it is unchanged.
const LEGACY_PREFIX = 'gpscontroller.'
const CURRENT_PREFIX = 'geomirage.'

// Legacy avatar keys (camelCase prefix + camelCase suffix) from before the
// snake_case convention was adopted.
const LEGACY_AVATAR_SELECTION = 'gpsController.avatarSelection'
const LEGACY_AVATAR_CUSTOM = 'gpsController.avatarCustom'

/**
 * One-shot migration of keys saved under earlier names: the camelCase
 * avatar keys and every `gpscontroller.*` key move to their `geomirage.*`
 * equivalents. Idempotent and cheap — call once at app boot, before
 * anything reads settings. Wrapped in a try/catch because Electron
 * sandboxing can throw on `localStorage` access; we silently skip in that
 * case (settings reset to defaults but nothing else breaks).
 */
export function migrateLegacyKeys(): void {
  try {
    if (typeof localStorage === 'undefined') return
    migrateOne(LEGACY_AVATAR_SELECTION, STORAGE_KEYS.avatarSelection)
    migrateOne(LEGACY_AVATAR_CUSTOM, STORAGE_KEYS.avatarCustom)
    const legacyKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key)
    }
    for (const key of legacyKeys) {
      migrateOne(key, CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length))
    }
  } catch {
    // localStorage unavailable — skip silently.
  }
}

function migrateOne(legacyKey: string, newKey: string): void {
  const legacy = localStorage.getItem(legacyKey)
  if (legacy === null) return
  // Treat the new key as canonical when both exist, so a value saved after
  // the upgrade is never overwritten by a stale legacy one.
  if (localStorage.getItem(newKey) === null) {
    localStorage.setItem(newKey, legacy)
  }
  localStorage.removeItem(legacyKey)
}
