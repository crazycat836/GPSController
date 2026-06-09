/** Centralized localStorage key constants. */
export const STORAGE_KEYS = {
  lang: 'gpscontroller.lang',
  tileLayer: 'gpscontroller.tile_layer',
  straightLine: 'gpscontroller.straight_line',
  tunnelIp: 'gpscontroller.tunnel.ip',
  tunnelPort: 'gpscontroller.tunnel.port',
  pauseMultiStop: 'gpscontroller.pause.multi_stop',
  pauseLoop: 'gpscontroller.pause.loop',
  pauseRandomWalk: 'gpscontroller.pause.random_walk',
  updateDismissed: 'gpscontroller.update_check.dismissed',
  updateLastCheck: 'gpscontroller.update_check.last_check',
  avatarSelection: 'gpscontroller.avatar_selection',
  avatarCustom: 'gpscontroller.avatar_custom',
  // Whether the bottom simulation dock is collapsed to its header only.
  // Persisted so the panel stays out of the way of the map across reloads.
  dockCollapsed: 'gpscontroller.dock_collapsed',
  // Gold Ditto (拉金盆) anchor — user's real-world coordinate. JSON-
  // serialised ``{lat, lng}`` so absent / malformed entries decode to
  // null cleanly and the UI re-prompts.
  goldDittoAnchor: 'gpscontroller.gold_ditto.anchor',
  // Optional user-supplied Google Places API key. When set, the search box
  // routes through Google (better POI / business / fuzzy-name results);
  // otherwise it falls back to the keyless Photon provider. Stored locally
  // and forwarded only to the local backend, never to a third party.
  googlePlacesKey: 'gpscontroller.google_places_key',
  // Forward-geocoding provider the search box uses. One of
  // 'nominatim' | 'photon' | 'google'. Persisted so the user's choice
  // survives reloads; 'google' additionally requires `googlePlacesKey`.
  searchProvider: 'gpscontroller.search_provider',
  // Last-selected movement speed: JSON `{moveMode, customSpeedKmh,
  // speedMinKmh, speedMaxKmh}`. Persisted so the speed the user picked
  // is reused on the next launch instead of resetting to Walking.
  speedPrefs: 'gpscontroller.speed_prefs',
} as const

// Legacy avatar keys (camelCase prefix + camelCase suffix) used before the
// canonical `gpscontroller.*` snake_case convention was adopted. Kept only
// so the one-shot migration below can promote a pre-existing value to the
// new key on first launch after upgrade.
const LEGACY_AVATAR_SELECTION = 'gpsController.avatarSelection'
const LEGACY_AVATAR_CUSTOM = 'gpsController.avatarCustom'

/**
 * One-shot migration: if a legacy avatar key has a value but the new key
 * doesn't, copy the value over and delete the legacy entry. Idempotent and
 * cheap — safe to call once at app boot. Wrapped in a try/catch because
 * Electron sandboxing can throw on `localStorage` access; we silently skip
 * in that case (the user's avatar resets to default but nothing else breaks).
 */
export function migrateAvatarKeys(): void {
  try {
    if (typeof localStorage === 'undefined') return
    migrateOne(LEGACY_AVATAR_SELECTION, STORAGE_KEYS.avatarSelection)
    migrateOne(LEGACY_AVATAR_CUSTOM, STORAGE_KEYS.avatarCustom)
  } catch {
    // localStorage unavailable — skip silently.
  }
}

function migrateOne(legacyKey: string, newKey: string): void {
  const legacy = localStorage.getItem(legacyKey)
  if (legacy === null) return
  // Don't clobber an explicit value already saved under the new key — that
  // would happen if the user upgraded, set a new avatar, then somehow the
  // legacy key reappeared. Treat the new key as canonical when both exist.
  if (localStorage.getItem(newKey) === null) {
    localStorage.setItem(newKey, legacy)
  }
  localStorage.removeItem(legacyKey)
}
