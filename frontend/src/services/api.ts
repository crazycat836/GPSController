/**
 * Barrel for the API client. The implementation is split into a transport
 * core (`http.ts`) and per-domain modules; everything that used to live in
 * this file is re-exported here so existing
 * `import * as api from '../services/api'` sites keep working unchanged.
 *
 * - `http.ts` — fetch retry/timeout policy, auth-token cache, envelope
 *   unwrapping, `ApiError`, `StatusResponse`
 * - `deviceApi.ts` — device list/connect/pair + WiFi tunnel
 * - `locationApi.ts` — teleport/navigate/loops/joystick/status/cooldown/
 *   speed + location settings
 * - `geocodeApi.ts` — forward + reverse geocoding
 * - `bookmarkApi.ts` — bookmarks, places, tags, import/export
 * - `routeApi.ts` — saved routes, categories, GPX + bulk import/export
 * - `systemApi.ts` — host utilities (open log folder)
 */
export { ApiError } from './http'
export type { StatusResponse } from './http'
export * from './deviceApi'
export * from './locationApi'
export * from './geocodeApi'
export * from './bookmarkApi'
export * from './routeApi'
export * from './systemApi'
