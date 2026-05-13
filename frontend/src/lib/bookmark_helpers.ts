import type { SavedRoute } from '../services/api'

// Pure helpers + types lifted out of BookmarkContext so the provider
// stays focused on state + handler wiring.

/** Outcome of `handleRouteSave`. The panel uses this to decide whether
 *  to surface the "overwrite / save as new / cancel" dialog. */
export type SaveRouteResult =
  | { kind: 'created'; route: SavedRoute }
  | { kind: 'overwritten'; route: SavedRoute }
  | {
      kind: 'conflict'
      existingId: string | null
      existingCreatedAt: string | null
    }
  | { kind: 'error'; message: string }

/** Pull the `{existing_id, existing_created_at}` fields out of a 409
 *  conflict response so the conflict dialog can show "saved YYYY-MM-DD"
 *  without a follow-up GET. Defensive against shape drift — every field
 *  is independently checked. */
export function parseConflictExtras(err: unknown): {
  existingId: string | null
  existingCreatedAt: string | null
} {
  const fallback = { existingId: null, existingCreatedAt: null }
  if (typeof err !== 'object' || err === null) return fallback
  const detail = (err as { detail?: unknown }).detail
  if (typeof detail !== 'object' || detail === null) return fallback
  const eid = (detail as Record<string, unknown>).existing_id
  const ets = (detail as Record<string, unknown>).existing_created_at
  return {
    existingId: typeof eid === 'string' ? eid : null,
    existingCreatedAt: typeof ets === 'string' ? ets : null,
  }
}

/** Slugify a route name into a filename-safe stem. Falls back to the
 *  route id when the name has no usable characters left. */
export function safeFilenameStem(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  return cleaned || fallback
}

/** Validate a parsed bookmark-store JSON dict has the minimum shape
 *  required for `api.importBookmarks` to accept it. Throws on failure
 *  so callers can show a unified "invalid file" toast. Runtime guard
 *  only — does not narrow the input type because `api.importBookmarks`
 *  takes the wider `BookmarkStore` shape that includes `tags`. */
export function validateBookmarkImport(data: unknown): void {
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as { places?: unknown }).places) ||
    !Array.isArray((data as { bookmarks?: unknown }).bookmarks)
  ) {
    throw new Error('invalid file: missing places or bookmarks array')
  }
}

/** Validate a parsed routes-bulk JSON dict has the minimum shape
 *  required for `api.importAllRoutes` to accept it. */
export function validateRoutesImport(data: unknown): void {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { routes?: unknown }).routes)) {
    throw new Error('invalid file: missing routes array')
  }
}
