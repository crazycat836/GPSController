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
  avatarSelection: 'gpscontroller.avatar_selection',
  avatarCustom: 'gpscontroller.avatar_custom',
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
