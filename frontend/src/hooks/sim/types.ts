/**
 * Shared types used by the simulation hook split.
 *
 * Lives here (rather than in `useSimulation.ts`) so that
 * `useSimWsDispatcher` and `useSimRuntimes` can import without a
 * circular dependency back through `useSimulation`.
 */

export interface LatLng {
  lat: number
  lng: number
}
