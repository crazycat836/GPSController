/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: backend/models/ws_events.py (WS_EVENTS registry)
 * Tool:   tools/gen_ws_types.py
 *
 * Re-run after editing the registry:
 *   python3 tools/gen_ws_types.py
 */


/** Emitted when usbmux watchdog auto-connects, manual /connect succeeds, */
export interface DeviceConnectedEvent {
  udid: string
  name?: string
  ios_version?: string
  connection_type?: 'USB' | 'Network'
}

/** Emitted on user-initiated disconnect, forget, USB unplug, WiFi tunnel */
export interface DeviceDisconnectedEvent {
  udid?: string
  udids?: string[]
  reason?: string
  cause?: string
  error?: string
}

/** Authoritative ground truth pushed once on every WS reconnect so the */
export interface DeviceSnapshotEvent {
  devices: Record<string, unknown>[]
}

/** Recoverable device-side error — e.g. USB fallback engine creation */
export interface DeviceErrorEvent {
  udid: string
  stage: string
  error: string
}

/** A secondary device just connected and we're about to replay the */
export interface DualSyncStartEvent {
  udid: string
  primary_udid: string
  mode: string
}

/** Tunnel asyncio task exited unexpectedly — frontend banners the */
export interface TunnelLostEvent {
  reason: string
}

/** Liveness probe couldn't reach the RSD endpoint — we haven't torn */
export interface TunnelDegradedEvent {
  reason: string
}

/** Liveness probe answered again after a degraded period — banner */
export interface TunnelRecoveredEvent {
  // (empty payload)
}

/** In-progress mount — surfaces a transient "mounting Developer Disk */
export interface DdiMountingEvent {
  udid: string
}

/** Mount completed successfully. */
export interface DdiMountedEvent {
  udid: string
}

/** Legacy event name retained for downstream consumers; carries the */
export interface DdiMountFailedEvent {
  udid: string
  stage: string
  reason: string
  hint_key: string
  error: string
}

/** User-facing failure — drives the "DDI not mounted" hint toast. */
export interface DdiMountMissingEvent {
  udid: string
  stage: string
  reason: string
  hint_key: string
}

/** Mirrors the ``CooldownStatus`` REST shape so the renderer can swap */
export interface CooldownUpdateEvent {
  enabled?: boolean
  is_active?: boolean
  remaining_seconds?: number
  total_seconds?: number
  distance_km?: number
}

/** High-frequency (~10 Hz) position sample emitted during every */
export interface PositionUpdateEvent {
  udid?: string
  lat: number
  lng: number
  bearing?: number
  speed_mps?: number
  progress?: number
  distance_remaining?: number
  distance_traveled?: number
  eta_seconds?: number
}

/** One-shot location update — emitted when the user teleports without */
export interface TeleportEvent {
  udid?: string
  lat: number
  lng: number
}

/** Drives the waypoint highlight pulse in the dock route card. */
export interface WaypointProgressEvent {
  current_index: number
  next_index: number
  total: number
}

/** Coarse state transition — frontend WS dispatcher routes these into */
export interface StateChangeEvent {
  state: string
  udid?: string
  detail?: Record<string, unknown>
}

/** Resolved OSRM polyline pushed once per leg start so the map can */
export interface RoutePathEvent {
  udid?: string
  coords: Record<string, number>[]
}

/** Inter-leg / inter-lap pause begins — countdown timer in the dock */
export interface PauseCountdownEvent {
  duration_seconds: number
  udid?: string
}

/** Pause finished — countdown UI clears and movement resumes. */
export interface PauseCountdownEndEvent {
  udid?: string
}

/** One loop / multi-stop lap finished. Frontend increments the lap */
export interface LapCompleteEvent {
  udid?: string
  lap_index: number
}

/** Multi-stop: arrived at one waypoint inside the leg sequence (not */
export interface StopReachedEvent {
  udid?: string
  stop_index: number
}

/** All waypoints visited (and laps run, when looping). Frontend */
export interface MultiStopCompleteEvent {
  udid?: string
}

/** Navigate-to-destination arrived. Frontend clears the destination */
export interface NavigationCompleteEvent {
  udid?: string
}

/** Reached one randomly-picked waypoint inside a random-walk loop. */
export interface RandomWalkArrivedEvent {
  udid?: string
}

/** Random-walk handler exited (user stopped or unrecoverable error). */
export interface RandomWalkCompleteEvent {
  udid?: string
}

/** User-initiated Restore finished — virtual location cleared, the */
export interface RestoredEvent {
  udid?: string
}

/** Movement loop hit a connection-class push error; about to back off */
export interface ConnectionLostEvent {
  retry: number
  max_retries: number
  next_retry_seconds: number
  udid?: string
}

export type WsEventType = "device_connected" | "device_disconnected" | "device_snapshot" | "device_error" | "dual_sync_start" | "tunnel_lost" | "tunnel_degraded" | "tunnel_recovered" | "ddi_mounting" | "ddi_mounted" | "ddi_mount_failed" | "ddi_mount_missing" | "cooldown_update" | "position_update" | "teleport" | "waypoint_progress" | "state_change" | "route_path" | "pause_countdown" | "pause_countdown_end" | "lap_complete" | "stop_reached" | "multi_stop_complete" | "navigation_complete" | "random_walk_arrived" | "random_walk_complete" | "restored" | "connection_lost";

/**
 * Discriminated union of every WebSocket event the backend emits.
 * Use as `switch (msg.type)` so the compiler narrows `msg.data`.
 */
export type WsEvent =
  | { type: "device_connected"; data: DeviceConnectedEvent }
  | { type: "device_disconnected"; data: DeviceDisconnectedEvent }
  | { type: "device_snapshot"; data: DeviceSnapshotEvent }
  | { type: "device_error"; data: DeviceErrorEvent }
  | { type: "dual_sync_start"; data: DualSyncStartEvent }
  | { type: "tunnel_lost"; data: TunnelLostEvent }
  | { type: "tunnel_degraded"; data: TunnelDegradedEvent }
  | { type: "tunnel_recovered"; data: TunnelRecoveredEvent }
  | { type: "ddi_mounting"; data: DdiMountingEvent }
  | { type: "ddi_mounted"; data: DdiMountedEvent }
  | { type: "ddi_mount_failed"; data: DdiMountFailedEvent }
  | { type: "ddi_mount_missing"; data: DdiMountMissingEvent }
  | { type: "cooldown_update"; data: CooldownUpdateEvent }
  | { type: "position_update"; data: PositionUpdateEvent }
  | { type: "teleport"; data: TeleportEvent }
  | { type: "waypoint_progress"; data: WaypointProgressEvent }
  | { type: "state_change"; data: StateChangeEvent }
  | { type: "route_path"; data: RoutePathEvent }
  | { type: "pause_countdown"; data: PauseCountdownEvent }
  | { type: "pause_countdown_end"; data: PauseCountdownEndEvent }
  | { type: "lap_complete"; data: LapCompleteEvent }
  | { type: "stop_reached"; data: StopReachedEvent }
  | { type: "multi_stop_complete"; data: MultiStopCompleteEvent }
  | { type: "navigation_complete"; data: NavigationCompleteEvent }
  | { type: "random_walk_arrived"; data: RandomWalkArrivedEvent }
  | { type: "random_walk_complete"; data: RandomWalkCompleteEvent }
  | { type: "restored"; data: RestoredEvent }
  | { type: "connection_lost"; data: ConnectionLostEvent };
