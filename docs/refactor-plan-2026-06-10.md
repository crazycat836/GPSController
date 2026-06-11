# GPSController — Pre-Refactor Review & Refactor Task List

**Date:** 2026-06-10
**Branch:** main
**Source:** multi-agent review (8 dimensions, adversarially verified: 65 HIGH/MEDIUM confirmed, 16 LOW, 1 rejected)

**Baseline (all green on current main):**

```bash
cd backend && python3 -m pytest tests/ -q          # 131 passed
frontend/node_modules/.bin/tsc --noEmit -p frontend/tsconfig.json
cd frontend && ./node_modules/.bin/vitest run       # 13 tests / 2 files
cd frontend && ./node_modules/.bin/vite build       # passes (913KB chunk warning)
```

Run all four after **every** phase. Manual checks the suites cannot cover: live navigate +
mid-route Apply Speed, pause/resume, Stop clearing the destination pin, dual-device join
mid-loop, backend kill/restart WS reconnect.

---

## Phase 1 — Safety net (characterization tests, no production changes)

Capture *current* behavior before touching anything. New test files only.

### Backend

- [x] **1.1** `tests/test_movement_loop.py` — `move_along_route` characterization
      (`backend/core/movement_loop.py:187-365`, zero coverage today):
      straight 3-point route emits monotonically increasing `distance_traveled` and ends
      with cleared `_active_route_coords`; `apply_speed` mid-route replans from current
      position and a second `apply_speed` slices the NEW coord list; stop/pause break the
      loop at documented checkpoints; waypoint-pass heuristics (`WP_HARD_HIT_M` /
      `WP_NEAR_M` / `WP_RECEDE_M`) fire `waypoint_progress`.
- [x] **1.2** `tests/test_simulation_engine.py` — engine lifecycle invariants
      (`backend/core/simulation_engine.py`): navigate/start_loop/stop/pause/resume state
      transitions + emitted `state_change` events with a fake LocationService; snapshot
      populated on start and `None` after `stop()`; forced return-to-IDLE on handler crash
      (354-363); `apply_speed` False when idle / True under joystick (707-719);
      `RouteInterpolator.interpolate` timing/segment output (pure function).
- [x] **1.3** `tests/test_engine_registry.py` — AppState engine-registry concurrency
      (`backend/state.py:205-314`): terminating the primary promotes the next udid;
      concurrent `create_engine_for_device` + `terminate_engine` never skips an engine's
      `stop()`; secondary connecting while primary has a `loop` snapshot triggers
      teleport + `start_loop` with the snapshot's `lap_count`/pauses.

### Frontend

- [x] **1.4** `src/hooks/sim/useSimWsDispatcher.test.ts` — table-driven dispatcher test:
      replay recorded WS frames through a fake `subscribe`, assert which setters fire per
      event type. Minimum: `position_update` partial-payload merge (243-253);
      `state_change` idle vs paused vs running (451-463); `tunnel_degraded` with/without
      udid (404-417); the three `*_complete` events (legacy-only destination clear, 343).
      May require adding `@testing-library/react` as a devDependency for `renderHook`.
- [x] **1.5** `src/contexts/SimContext` helpers — unit-test `toastForFanout`
      (all-ok / all-fail / partial) and `runWithFanout` (single vs multi threshold;
      currently module-private — export it or test via provider).
- [x] **1.6** `src/hooks/useWebSocket.test.ts` — mock WebSocket class: two synchronous
      `onmessage` frames both reach a subscriber (issue #5 regression); `connected` stays
      false until first server frame after `onopen`; close schedules reconnect with delay
      growing toward `MAX_RECONNECT_INTERVAL`.

---

## Phase 2 — Verified functional bugs (fix with regression tests)

- [x] **2.1** API error contract: `throwEnvelopeError` (`frontend/src/services/api.ts:201-209`)
      throws plain `Error` with no `code`/`detail`, so `BookmarkContext.tsx:238-242`'s 409
      conflict branch can never fire and RoutesPanel's overwrite dialog (192-204) is dead.
      → Add an `ApiError` class carrying `code` + envelope payload; check
      `err instanceof ApiError && err.code === 'route_name_conflict'`. Test the 409 path.
- [x] **2.2** Unawaited single-device actions: `SimContext.tsx:439` (`sim.multiStop`) and
      `:476` (`sim.randomWalk`) are not awaited → backend rejection becomes an unhandled
      promise rejection, no toast (navigate path awaits correctly). → `await` both.
- [x] **2.3** Unguarded GPX parse: `backend/api/route.py:240` — malformed XML raises
      `GPXXMLSyntaxException` → plain-text 500 bypassing the envelope. → wrap in
      try/except → `http_err(400, ErrorCode.GPX_DECODE_FAILED, ...)`.
- [x] **2.4** Malformed WS joystick frame kills the socket: `backend/api/websocket.py:375-379`
      constructs `JoystickInput` unguarded; pydantic `ValidationError` escapes to the outer
      handler and terminates the receive loop. → drop the frame
      (`except (ValidationError, TypeError): continue`).
- [x] **2.5** `fetchWithRetry` replays non-idempotent POSTs (`frontend/src/services/api.ts:104-127`):
      mid-flight connection reset is retried up to 15× (double-save / double-import /
      replayed teleport). → retry only GET; keep backoff for boot-time connection-refused.
- [x] **2.6** Connect rollback inconsistency: `backend/api/device.py:90-97` and
      `backend/api/tunnel/_helpers.py:276-288` leave connection_state CONNECTED with no
      engine when engine creation fails; only `_attempt_usb_fallback`
      (`api/tunnel/lifecycle.py:203-227`) rolls back. → extract a shared
      connect-with-rollback helper used by all three paths.
- [x] **2.7** Catch-all exception handler (`backend/main.py:267`): register an
      `Exception` handler returning the `{success,data,error}` envelope with a new
      `internal_error` ErrorCode (+ i18n entry) so uncaught errors stop leaking
      Starlette plain-text 500s.

---

## Phase 3 — Dead code cleanup (single commit, mechanical deletes)

All verified dead by project-wide grep including dynamic-key patterns.

### Frontend

- [x] **3.1** i18n: delete the 157 orphaned keys in `src/i18n/strings.ts` (~25% of 624).
      **Keep every `err.*` key** — live via `` `err.${e.code}` `` (api.ts:185) and pinned
      by the `BACKEND_ERROR_CODES` contract test. Largest dead groups: `panel.*` (61),
      `wifi.*` (24), `bm.*` (18), `status.*` (10).
- [x] **3.2** Dead files: `src/components/ui/CollapsibleSection.tsx`,
      `src/components/DeviceChip.tsx` (also fix the stale comment in
      `shell/StatusPill.tsx:7`), `src/hooks/useDisabledByConnection.ts`,
      `src/styles/components/skeleton.css` (+ its `@import` in `src/index.css:15`).
- [x] **3.3** `legacy.css`: strip dead rule blocks (`.section-title`, `.mode-btn`,
      `.speed-selector/.speed-btn`, `.search-results`, `.control-panel`,
      `.device-status`, `.bookmark-item/.bookmark-group`); keep live selectors
      (`.action-btn`, `.context-menu`, `.eta-bar`, `.joystick-*`, `.search-input`,
      `.toast-pill*`, `.status-bar`, `.sr-only`).
- [x] **3.4** Dead API wrappers in `services/api.ts`: `dismissCooldown`, `getCoordFormat`,
      `setCoordFormat`, `openLog`, `planRoute`, `optimizeRoute` + orphaned types
      (`RoutePlanResponse`, `OptimizeOrderResponse`, `RouteNameConflictDetail` — note 2.1
      may resurrect the conflict detail type; reconcile).
- [x] **3.5** Broken wifiConnect chain (endpoint removed in v0.1.49): `api.ts:344
      wifiConnect` → `useWifiTunnel.ts:64-84 connectWifi` → pass-through in
      `useDevice.ts:226-238`.
- [x] **3.6** Dead exports: `MODE_LABEL_KEYS` (useSimulation.ts:101), `getPresetSvg`
      (lib/avatars.ts:37), `METERS_PER_DEGREE_LAT` (lib/geo.ts:11), `IconSize`
      (lib/icons.ts:11). Un-export internal-only symbols: `toastForFanout`,
      `stateToMode`, `summarizeResults`, `JOYSTICK_SENSITIVITY_DEFAULT`, `API_HOST`,
      `formatDisplaySpeed` (keep exported if Phase 1 tests need them).
- [x] **3.7** Enable `noUnusedLocals`/`noUnusedParameters` in `tsconfig.json` after
      clearing the 11 current hits (unused `joystick` in App.tsx:137 + 10 redundant
      `import React` defaults).

### Backend

- [x] **3.8** `/wifi/scan` chain: route (`api/tunnel/scan.py:21`),
      `DeviceManager.scan_wifi_devices` (~70 lines), `_guess_local_subnet`,
      `_load_pair_record` (confirm no other caller), `create_using_tcp` import, plus the
      frontend `wifiScan`/`scanWifi`/`wifiDevices`/`wifiScanning` surface.
- [x] **3.9** `CoordinateFormatter` (`services/coord_format.py`): shrink to a coord-format
      preference holder; delete the ~210 lines of format/parse logic (zero callers).
- [x] **3.10** Write-only `_no_auto_reconnect` blocklist (`state.py:76,183`): remove the
      plumbing (state methods, `/auto-reconnect/reset` endpoint at api/device.py:100,
      frontend boot call in useDevice.ts:54).
- [x] **3.11** Unconsumed endpoints: `GET /api/device/{udid}/info` (device.py:295),
      `DELETE /api/location/simulation` (location/lifecycle.py:87), standalone
      `POST /wifi/tunnel` (pair.py:38) and `POST /wifi/tunnel/start` (lifecycle.py:164)
      — the UI uses `/wifi/tunnel/start-and-connect` exclusively.
- [x] **3.12** Dead method `AppState.clear_position_settings` (state.py:186); unused
      imports: `time`/`MAX_DEVICES` (main.py), `SPEED_PROFILES` (simulation_engine.py:23),
      `HTTPException` (location/lifecycle.py:13), `urllib.request`+`visual_width`
      (start.py), `os`+`visual_width` (build.py — narrow the noqa to E402).
- [x] **3.13** Housekeeping: clear stale `.claude/worktrees/agent-*` leftovers.

---

## Phase 4 — Structural refactor (one sub-step at a time, verify between each)

### 4A Frontend state architecture (highest leverage)

- [x] **4A.1** Make legacy single-device sim fields a derived view of `runtimes`
      (`primaryRuntime` memo already exists, useSimulation.ts:685-688) so there is one
      write path; migrate remaining consumers; delete the legacy branch of
      `useSimWsDispatcher` (310-465). Gate on the Phase 1.4 dispatcher tests.
- [x] **4A.2** Split `SimContext` into a stable `SimActionsContext` (the ~17 useCallback-
      stable handlers) and a ticking `SimStateContext`, extending the existing
      SimDerivedContext pattern. Stop exposing the raw `sim` object. Fixes the
      every-tick re-render of 14 consumers + removes the workaround refs
      (RoutesPanel.tsx:73-80) and App.tsx's keydown re-subscription (258-282).
- [x] **4A.3** Shrink `useSimulation` (762L): extract `useSpeedPrefs` and
      `useSimGroupActions` into `hooks/sim/`.
- [x] **4A.4** Split `BookmarkContext`: extract `RouteLibraryContext` (savedRoutes,
      routeCategories, handleRoute*/handleGpx*, import/export) — the halves share no
      state, only `showToast`/`t`.
- [x] **4A.5** Break the services↔hooks type cycle: move `Bookmark`/`BookmarkPlace`/
      `BookmarkTag`/`DeviceInfo` into `src/types/`; split `api.ts` into
      `services/http.ts` (transport, ApiError) + per-domain modules with a barrel
      re-export. Fix `useSerializedReorder`'s caller-supplied deps
      (BookmarkContext.tsx:33-65) → ref-based stable handler.

### 4B Backend boundaries

- [x] **4B.1** Composition root: register all long-lived singletons on AppState
      (SavedRoutesStore/RouteService/GpxService now module-globals in api/route.py:34;
      TunnelRunner in wifi_tunnel_service.py:35; watchdog handle in
      api/tunnel/_helpers.py:33) and route the 29 direct `ctx.app_state` accesses
      through one expanded `api/_deps.py` accessor set.
- [x] **4B.2** Extract device-health probes out of `api/websocket.py` (50-217) into
      `services/device_health.py`; give LocationService a **public** probe API (the
      `getattr(loc, "_ensure_instrument", None)` pattern silently disables the probe on
      rename).
- [x] **4B.3** Move engine recovery (`_get_or_rebuild_engine`, `_force_reconnect`,
      `exec_with_retry` — api/location/_helpers.py:60-148) into a service; move the
      forget_device flow (api/device.py:127-292) into core.
- [x] **4B.4** `SimulationSnapshot.replay_on(engine)` to replace the hand-spelled 4-way
      kwargs dispatch in `state.py:368-417`; extract `_sync_new_device_to_primary` into
      its own module; extract a `SettingsStore` from AppState.
- [x] **4B.5** Decide and document the real core↔services arrow; pass AppState/engine
      registry into tunnel_liveness/wifi_keepalive loops as parameters instead of `ctx`
      imports; extend `tools/check_layers.py` to enforce the chosen direction. Replace
      `reconnect_usb_over_wifi`'s private `_collect_metadata` + hand-rolled double
      transition with a public `connection_state.reannounce_connected(...)`.

### 4C DRY consolidation (do alongside the modules being touched)

- [ ] **4C.1** Backend movement handlers: shared `fetch_route_coords` / `emit_route_path` /
      `finish_mode` helpers; `osrm_profile_for(mode)` (4 copies);
      `pause_with_countdown(engine, duration, source)` (3 copies); a per-leg runner for
      multi_stop/random_walk/route_loop; `stop_task(...)` helper for main.py lifespan.
- [ ] **4C.2** Backend stores: shared `reorder_by_ids` (3 copies) and a `JsonModelStore`
      base (load/migrate/presets/quarantine/persist/locking) — bookmarks gains the
      quarantine protection saved_routes already has.
- [ ] **4C.3** Frontend library UI: generic `ItemManagerDialog` (PlaceManager/TagManager
      ~300-line clones); `SortableHandleRow` + `useDragReorder` (5 dnd-kit copies);
      `InlineRenameInput` + `commitTrimmedRename` (5 copies, IME guard);
      `useSelectionSet` / `useReorderMode` shared by Bookmarks/Routes panels.

---

## Phase 5 — Lower priority (do opportunistically)

- [ ] **5.1** Security: strip `initial_position` from the unauthenticated `/` health
      check (main.py:355-362); refuse root `pip install`/`npm install` in start.py (or
      drop privileges via SUDO_UID/GID); chown the token file back to the invoking user
      under sudo (main.py:59-77, reuse json_safe's `_chown_back`); consider Electron
      `safeStorage` for the Google Places key.
- [ ] **5.2** Error-handling consistency: WS error event for crashed movement tasks
      (api/location/_helpers.py:289-310); typed + size-capped bookmark import body
      (api/bookmarks.py:264); `save_settings` failure → 500 envelope (state.py:118);
      `.catch` + rollback toast on the optimistic reorders (PlaceManagerDialog.tsx:226,
      TagManagerDialog.tsx:214, BookmarkContext.tsx:355).
- [ ] **5.3** Misc LOW: shared `kill_port` for start.py/stop.py; fix stale
      `from main import AppState` TYPE_CHECKING import (context.py:12); close the
      lockdown client in `wifi_repair` (api/tunnel/pair.py:76-106); hoist `_jitter_loop`
      magic numbers to module constants; code-split the 913KB bundle.

---

## Working agreement

- One phase (or 4x sub-step) per commit; conventional commit messages.
- Never start a structural change without the relevant Phase 1 tests in place.
- After every commit: pytest + tsc + vitest + vite build, all green.
- Behavior parity is the goal — any intentional behavior change must be called out
  explicitly in the commit body.
