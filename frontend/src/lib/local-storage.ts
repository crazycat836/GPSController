/**
 * Sandbox-safe localStorage accessors.
 *
 * localStorage access can throw (Electron sandbox, private browsing,
 * quota exceeded); every UI feature that persists a preference treats
 * that as "fall back to the default / skip the write". These helpers
 * centralize the try/catch so call sites keep only their own
 * validation and defaults.
 */

/** getItem — null when the key is missing or storage is unavailable. */
export function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** setItem — silently skipped when storage is full or disabled. */
export function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // In-memory state still works; the value just won't survive reload.
  }
}

/** removeItem — silently skipped when storage is unavailable. */
export function removeLS(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/** getItem + JSON.parse — null when missing, corrupt, or unavailable. */
export function readJSON(key: string): unknown {
  const raw = readLS(key)
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** JSON.stringify + setItem — silently skipped on storage errors. */
export function writeJSON(key: string, value: unknown): void {
  writeLS(key, JSON.stringify(value))
}
