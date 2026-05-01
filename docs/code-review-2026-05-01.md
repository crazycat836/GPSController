# GPSController — Code Review

**Date:** 2026-05-01
**Branch:** main

**Stack:** FastAPI + pymobiledevice3 backend; Vite + React + TypeScript frontend (also Electron). ~8.5K Python lines (44 files), ~18K TypeScript lines (~95 files).

**Auth posture (good baseline):** server binds `127.0.0.1` only (`backend/config.py:98`), every REST + WS request gated by `X-GPS-Token` (`backend/main.py:690-720`) compared with `secrets.compare_digest`, token written 0600 to `~/.gpscontroller/token`. **No hardcoded API keys, no XSS sinks, no `eval`, no `dangerouslySetInnerHTML`, no TODO/FIXME debt markers** were found.

---

## Status

> **v0.14.1 (2026-05-01)** — released [v0.14.1](https://github.com/crazycat836/GPSController/releases/tag/v0.14.1). 5 HIGH items fully resolved + 1 partial. 17 HIGH items remain outstanding. Fixed items inline below are marked **[DONE v0.14.1]**; partial progress is marked **[PARTIAL v0.14.1]**.
>
> **Remaining HIGH items by category:**
> - Architecture / God modules: 3 outstanding (oversize components, `wifi_tunnel.py`, backend movement loops)
> - Bugs / correctness: 7 outstanding (DevicesPopover ×2, useDevice ordering, MapContextMenu ×2, wifi_tunnel watchdog race, setCooldownEnabled StrictMode)
> - Security: 4 outstanding (`noopener`, import body validation, subnet semaphore, `forget_device` partial-success)
> - Error handling: 3 outstanding (silent excepts ×37, `LegacyLocationService.clear`, GPX UTF-8)
> - Auth / token: 2 outstanding (401 invalidation, export-URL token)

---

## HIGH Priority

### Architecture / God modules

- **[PARTIAL v0.14.1] [HIGH] Architecture — `useSimulation.ts` is a 1126-line god hook**
  - File: `frontend/src/hooks/useSimulation.ts:1-1126`
  - Bundles seven concerns: WS dispatch, per-device runtimes, group fan-out, single-device actions, pause persistence, straight-line toggle, error translator. Returns 50+ values; consumers re-render on every WS tick.
  - Fix: split into `useSimWsDispatcher`, `useSimRuntimes`, `useSimGroupFanout`, `useSimSingle`, `usePauseSettings`, `useStraightLineToggle`, `useSimErrorTranslator`. `useSimulation` becomes a thin aggregator.
  - **v0.14.1**: extracted `useSimWsDispatcher` + `useSimRuntimes` + `usePauseSettings` + `useStraightLineToggle` to `hooks/sim/`. File now 656 lines (down from 1134). `useSimGroupFanout` / `useSimSingle` deferred — would funnel 30+ setters through a bundle pattern without reducing complexity.

- **[HIGH] Architecture — `BottomDock.tsx` (689), `BookmarksPanel.tsx` (886), `DevicesPopover.tsx` (735), `SimContext.tsx` (670), `MapView.tsx` (568), `useDevice.ts` (556) all approach or exceed the 800-line cap**
  - Files listed above
  - Each hosts 3+ subviews / multi-step state machines. Large reach for any single edit; high regression surface.
  - Fix: extract subview components (`DeviceListView`, `DeviceManageView`, `DeviceAddView` for the popover; `BookmarkRow`, `BookmarksToolbar`, `BookmarkFooter` for the panel) into per-file modules.

- **[HIGH] Architecture — `backend/api/wifi_tunnel.py` 673 lines with 165-line `wifi_repair` and 69-line `wifi_tunnel_stop` functions**
  - File: `backend/api/wifi_tunnel.py:138-303` (`wifi_repair`), `562-630` (`wifi_tunnel_stop`)
  - `wifi_tunnel_stop` reaches 8 levels of nested `try/except`. `wifi_repair` mixes USB selection, lockdown autopair, RemotePairing handshake, teardown.
  - Fix: extract `_select_usb_device`, `_perform_remote_pair_handshake`, `_close_remote_pair_resources`; replace nested catches with a state machine.

- **[HIGH] Architecture — Multiple 200+ line single-responsibility-violating loops**
  - `backend/core/movement_loop.py:42-291` `move_along_route` (~250 lines)
  - `backend/core/multi_stop.py:23-237` `MultiStopNavigator.start` (~215 lines)
  - `backend/core/random_walk.py:25-246` `RandomWalkHandler.start` (~222 lines)
  - Each contains hot-swap re-interp + per-leg execution + emit logic in one function with deep nesting.
  - Fix: extract `_run_iteration`, `_handle_pending_speed`, `_emit_position_update`, `_run_leg`, `_pause_at_stop`.

### Bugs (correctness)

- **[HIGH] Stale ref read — scan result count is read before React commits**
  - File: `frontend/src/components/device/DevicesPopover.tsx:66`
  - `setScanResult(devicesRef.current.length)` runs in `finally` after the awaited scan, but `devicesRef.current` is updated by an effect that hasn't run yet → stale count.
  - Fix: have `device.scan()` return the list (it already does at `useDevice.ts:324`) and use the return value: `const list = await device.scan(); setScanResult(list.length)`.

- **[HIGH] Effect re-runs on identity change — `view` resets every parent render**
  - File: `frontend/src/components/device/DevicesPopover.tsx:48`
  - `useEffect(() => { if (anchor) setView('list') }, [anchor])` — `anchor: DOMRect` is a fresh object identity each open or window resize.
  - Fix: depend on the boolean: `useEffect(() => { if (anchor) setView('list') }, [!!anchor])`.

- **[HIGH] Order-losing setDevices**
  - Files: `frontend/src/hooks/useDevice.ts:443` (and same pattern at `:487`)
  - `setDevices(prev => [...prev.filter(d => d.udid !== info.udid), info])` always appends — known devices jump to the end whenever they re-arrive via WS.
  - Fix: `findIndex` then in-place replace; append only when not found.

- **[DONE v0.14.1] [HIGH] Optimistic state without rollback**
  - File: `frontend/src/hooks/useSimulation.ts:809-853` (`pause`/`resume`/`joystickStart`/`joystickStop`); same shape in `navigate`/`startLoop`/`multiStop`/`randomWalk` (lines 730-805).
  - `setStatus` runs before `await api.*()`; failed call leaves UI inconsistent with backend.
  - Fix: only update state after successful await, or revert in `catch`.
  - **v0.14.1**: `navigate` / `startLoop` / `multiStop` / `randomWalk` / `joystickStart` capture pre-call mode via `modeRef.current` and revert on rejection; `pause`/`resume`/`joystickStop` were already post-await (no fix needed).

- **[HIGH] Click handler installed before menu paints**
  - File: `frontend/src/components/MapContextMenu.tsx:75`
  - `document.addEventListener('click', handler)` registered synchronously; the right-click that opened the menu can immediately bubble to `document` and close it on browsers that synthesize a `click` after `contextmenu`.
  - Fix: register inside `setTimeout(..., 0)` or use `mousedown` + ref-bounds check (see `DevicesPopover` for the pattern).

- **[HIGH] Async fetch with no abort/unmount guard**
  - File: `frontend/src/components/MapContextMenu.tsx:103`
  - `await reverseGeocode(lat, lng)` — closing the menu doesn't cancel the request; `setWhatsHere` may run on unmounted tree.
  - Fix: AbortController + `if (cancelled) return` guard.

- **[HIGH] `wifi_repair` / `wifi_tunnel_stop` race**
  - File: `backend/api/wifi_tunnel.py:458-504` (`_tunnel_watchdog`)
  - After 5s sleep, the watchdog re-acquires `_tunnel.lock` and checks `_tunnel.task is task`. If `wifi_tunnel_stop()` has run and a fresh `wifi_tunnel_start()` is mid-flight, `_tunnel.task` could be transiently `None` and the watchdog will tear down healthy resources.
  - Fix: track tunnel generation (monotonic counter) and bail when generation changed.

- **[DONE v0.14.1] [HIGH] `apply_speed` mutates engine without lock**
  - File: `backend/core/simulation_engine.py:552-578`
  - Concurrent `stop()` (which clears `_active_route_coords` in `core/movement_loop.py:289-291`) can race with `apply_speed`'s write to `_pending_speed_profile` / `_joystick.speed_profile`.
  - Fix: serialise behind a dedicated `asyncio.Lock` on the engine and re-check `state` after acquire.
  - **v0.14.1**: `apply_speed` is now async, holds `_apply_speed_lock`, and re-reads `state` + `_active_route_coords` after acquire.

- **[DONE v0.14.1] [HIGH] `BookmarkManager` mutates shared state without locks**
  - File: `backend/services/bookmarks.py` (entire class)
  - `create_*`, `update_*`, `delete_*`, `reorder_*`, `import_json` all mutate `self.store.places / .tags / .bookmarks` and call `_save()` without serialisation. Concurrent `POST /api/bookmarks` requests can interleave list mutations and the last-writer-wins JSON dump.
  - Fix: an `asyncio.Lock` inside `BookmarkManager` covering every mutator + `_save()`.
  - **v0.14.1**: 16 mutators converted to async + wrapped in `async with self._lock`. Read-only methods stay sync.

- **[HIGH] `setCooldownEnabled` rollback double-toggles in StrictMode**
  - File: `frontend/src/contexts/SimContext.tsx:301`
  - `api.setCooldownEnabled(enabled).catch(() => setCooldownEnabled((v) => !v))` — `(v) => !v` runs twice in dev StrictMode, double-toggling. Also user is never notified of the failure.
  - Fix: revert with the original boolean (`setCooldownEnabled(!enabled)`) and `showToast` on failure.

### Security

- **[DONE] [HIGH] `window.open` without `noopener`/`noreferrer` (reverse-tabnabbing)**
  - File: `frontend/src/contexts/BookmarkContext.tsx:189`
  - In Electron the renderer is sandboxed; in browser dev mode the new tab gets `window.opener`.
  - Fix: `window.open(url, '_blank', 'noopener,noreferrer')`. (The pattern in `lib/fileIo.ts:45` uses `a.rel = 'noopener'` correctly — apply the same here.)
  - **Fixed**: `handleGpxExport` now passes `'noopener,noreferrer'` features arg.

- **[HIGH] Unvalidated `dict` POST body**
  - File: `backend/api/bookmarks.py:240` (`import_bookmarks`), `backend/services/bookmarks.py:532-579` (`import_json`)
  - Endpoint accepts `data: dict` then round-trips through `bm.import_json(json.dumps(data))`. A malicious export can re-use IDs that collide with default place IDs (defended in part by `existing_bm_ids` check, but tags/places aren't equally guarded).
  - Fix: bind a Pydantic schema; regenerate IDs on import (the way `api/route.py:124` does for `import_all_saved_routes`).

- **[HIGH] Subnet scan is unrate-limited (~254 concurrent connects)**
  - File: `backend/api/wifi_tunnel.py:331-363` (`_tcp_probe`, `_scan_subnet_for_port`)
  - Fires 254 parallel TCP probes every scan. On corporate networks this looks like reconnaissance.
  - Fix: gate with `asyncio.Semaphore(32)`.

- **[HIGH] `forget_device` partial-success silently masked**
  - File: `backend/api/device.py:137-195`, `_pair_record_candidates` (`:121-133`)
  - On macOS without root, `path.unlink()` on `/var/db/lockdown/*.plist` raises and is logged at WARNING (`:179`) but the endpoint still returns `{"status": "forgotten", "udid": udid, "removed": removed}` — UI thinks the device was forgotten while the iPhone still trusts the host.
  - Fix: surface aggregate `{"removed": [...], "failed": [...]}` and include `"failed"` in the success response so the UI can prompt for sudo / show a warning.

### Error handling

- **[HIGH] 37 silent `except: pass` blocks in backend**
  - Files (clusters): `backend/api/wifi_tunnel.py` (10×: `:108`, `:285`, `:295`, `:340`, `:469`, `:492`, `:524`, etc.), `backend/api/device.py:70`, `:117`, `:177`, `backend/main.py:616`, `backend/core/ddi_mount.py` (5×), `backend/core/wifi_tunnel.py:80`, `:103`, `:105`, others.
  - Many wrap WS broadcasts (acceptable best-effort) but several wrap real cleanup that hides bugs (e.g. teardown in `wifi_tunnel.py:273-295`).
  - Fix: change every `except Exception: pass` to at least `logger.debug(..., exc_info=True)`. Promote anything in non-best-effort paths to `logger.warning`.

- **[HIGH] `LegacyLocationService.clear` swallows DeviceLost**
  - File: `backend/services/location_service.py:252-258`
  - `clear()` catches the reconnect-retry failure and only logs; `set()` correctly raises `DeviceLostError`. Result: a `clear()` failure on a dead device never propagates and the engine thinks everything is fine.
  - Fix: raise `DeviceLostError` in both paths.

- **[DONE] [HIGH] `import_gpx` 500s on non-UTF-8 GPX**
  - File: `backend/api/route.py:149` (`text = content.decode("utf-8")`)
  - Real-world devices export UTF-16 / latin-1 GPX. Current behaviour: 500 with raw decode error on the wire.
  - Fix: try `utf-8` then fall back to `latin-1`, or raise a structured `{"code": "gpx_decode_failed"}` 400.
  - **Fixed**: tries UTF-8 → UTF-16 → latin-1 in order; on all-three failure raises `400 gpx_decode_failed` via the standard envelope.

- **[DONE v0.14.1] [HIGH] `try { … } catch (err) { throw err }` boilerplate**
  - File: `frontend/src/hooks/useSimulation.ts:711-901` (12 occurrences in action callbacks)
  - The catch is dead — re-throws unchanged. Adds noise without behaviour.
  - Fix: delete the try/catch; let the await reject naturally.
  - **v0.14.1**: all 12 wrappers removed.

- **[DONE v0.14.1] [HIGH] `Promise.allSettled` wrapped in unreachable try/catch**
  - File: `frontend/src/hooks/useSimulation.ts:975` (`preSyncStart`)
  - `allSettled` never rejects, so the catch is dead. Failed pre-sync teleports proceed silently.
  - Fix: inspect results and bail/log on rejected entries; remove the dead try/catch.
  - **v0.14.1**: dead catch removed; rejected results now dev-logged via `console.warn` (gated by `import.meta.env.DEV`).

### Auth / token edge cases

- **[HIGH] Auth-token cache never invalidates on 401**
  - File: `frontend/src/services/api.ts:142-156`
  - `authTokenPromise` is cached for the page lifetime. Server-side token rotation (currently doesn't happen, but is a documented future risk) → indefinite 401 with no recovery.
  - Fix: on a 401 response, set `authTokenPromise = null` and retry once.

- **[HIGH] Export URLs bypass the token**
  - File: `frontend/src/services/api.ts:336` (`bookmarksExportUrl`), `:391` (`exportGpxUrl`), `:396` (`exportAllRoutesUrl`)
  - URL-only helpers fed into `<a href>` / `window.open` (`BookmarkContext.tsx:189`). With `X-GPS-Token` enforced, these requests get a 401 and the user gets a blank tab.
  - Fix: route through `request()` and trigger a Blob download client-side, or have the backend mint short-lived signed URLs.

---

## MEDIUM Priority

### DRY violations / duplicated logic

- **[MEDIUM] `_http_err` defined identically in three files**
  - `backend/api/wifi_tunnel.py:26`, `backend/api/device.py:19`, `backend/api/location.py:31`
  - Fix: hoist to `backend/api/_errors.py`.

- **[MEDIUM] `DeviceLostError` cause-walking duplicated**
  - `backend/core/simulation_engine.py:236-242`, `backend/api/location.py:236-242`, `:265-269`, `:292-300`
  - Fix: extract `_unwrap_device_lost(exc) -> DeviceLostError | None`.

- **[MEDIUM] `_IS_DEV` + `devLog` reimplemented per file**
  - `frontend/src/contexts/BookmarkContext.tsx:8`, `frontend/src/hooks/useDevice.ts:21`, `frontend/src/hooks/useBookmarks.ts:4` — three near-identical implementations.
  - Fix: single `frontend/src/lib/dev-log.ts`.

- **[MEDIUM] Clipboard fallback duplicated**
  - `frontend/src/components/library/BookmarksPanel.tsx:210`, `frontend/src/components/MapContextMenu.tsx:252`
  - Fix: `frontend/src/lib/clipboard.ts`.

- **[DONE v0.14.1] [MEDIUM] Two parallel translation tables**
  - `frontend/src/services/api.ts:84-107` (`ERROR_I18N`) vs `frontend/src/i18n/strings.ts`
  - Translators must keep both in sync; missing keys don't fail typecheck.
  - Fix: move every `ERROR_I18N` entry into `i18n/strings.ts` under an `err.*` namespace, pass `t` into `formatError`.
  - **v0.14.1**: `ERROR_I18N` removed; 7 missing keys added under `err.*`. `formatError` looks up `STRINGS['err.<code>']`.

- **[MEDIUM] Default pause object hardcoded in three places**
  - `frontend/src/hooks/useSimulation.ts:387,394,396,406` (`{ enabled: true, min: 5, max: 20 }`), `frontend/src/services/api.ts:218-219`, plus `frontend/src/lib/constants.ts:35` (which already exports `DEFAULT_PAUSE` but is unused)
  - Fix: import `DEFAULT_PAUSE` from constants everywhere.

- **[MEDIUM] Per-handler fan-out branching repeated**
  - `frontend/src/contexts/SimContext.tsx:339, 356, 465, 480, 495, 505` — every handler does `if (udids.length >= 2) toast(t('multi.start')) ; … else single` with the same toast wrapping.
  - Fix: a `runWithFanout(action, single, multi)` helper.

- **[MEDIUM] Modal anatomy reimplemented in 4+ places**
  - `App.tsx:337-388`, `SettingsMenu.tsx:301-384`, `BookmarkEditDialog.tsx`, `AvatarPicker.tsx` each define their own overlay + Esc handling + focus trap.
  - Fix: one `<Modal title body actions />` primitive that uses existing `useModalDismiss` + `useFocusTrap`.

- **[MEDIUM] `MODE_LABEL_KEYS` duplicated**
  - `frontend/src/components/shell/BottomDock.tsx:184` hardcodes a SimMode→label-key map; `frontend/src/hooks/useSimulation.ts:233` already exports `MODE_LABEL_KEYS`.
  - Fix: import the existing constant.

### Response format inconsistency

- **[DONE v0.14.1] [MEDIUM] No consistent envelope across the API surface**
  - Mix of `{"status": "ok|started|stopped|deleted|forgotten|connected|disconnected|opened|already_running|not_running|dismissed"}`, raw model objects, counter-only `{"moved": N, "deleted": N}`, and `{"detail": {"code","message"}}` for errors.
  - Examples: `backend/api/location.py:201, 250, 324, 338, 386`; `backend/api/bookmarks.py:114, 128, 135, 244`; `backend/api/route.py:83`; `backend/api/device.py:71, 98, 118, 195, 269`.
  - Fix: standardise on `{success, data, error, meta}` envelope (per `~/.claude/rules/common/patterns.md`).
  - **v0.14.1**: `{success, data, error, meta?}` envelope adopted via `EnvelopeJSONResponse` (default response class) + global `HTTPException` / `RequestValidationError` handlers. File-download endpoints bypass via raw `Response(bytes)`. Frontend `request<T>()` unwraps `body.data`.

### Hardcoded user-facing strings (i18n leakage)

- **[MEDIUM] Backend Chinese error messages in 30+ places**
  - Heaviest: `backend/api/location.py:82, 114, 156, 199, 222, 243, 524`; `backend/api/device.py:54, 78-83, 225, 237, 250, 264`; `backend/api/wifi_tunnel.py:70, 94, 121-128, 132, 191, 538, 545, 654, 673`; `backend/api/system.py:61, 75`; `backend/core/device_manager.py:378-380, 561-563`.
  - The `code` field is in English (good). The `message` is Chinese-only — non-zh users see Chinese.
  - Fix: keep `code` as the source of truth; let the frontend i18n layer pick the message. Drop or English-ify the backend-side `message` fields.

- **[MEDIUM] Frontend leaked strings**
  - `frontend/src/components/library/BookmarksPanel.tsx:51-53` (`'預設'`, `'Default'`, `'Uncategorized'`) — same magic at `PlaceManagerDialog.tsx:57`, `BookmarkEditDialog.tsx:268`.
  - `frontend/src/components/shell/SettingsMenu.tsx:212, 215` (`'中文'` / `'English'`).
  - Fix: a single `isDefaultPlace(name)` helper for the bookmark special-name; add `lang.zh_native` / `lang.en_native` to `i18n/strings.ts`.

### Magic numbers / hardcoded config

- **[MEDIUM] No env-var override for backend external services**
  - `backend/config.py:18` (`OSRM_BASE_URL`), `:21` (`NOMINATIM_BASE_URL`)
  - Operators on restricted networks / self-hosted OSRM must fork the file.
  - Fix: `os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org")`.

- **[MEDIUM] No env-var override for the frontend API host**
  - `frontend/src/lib/constants.ts:29` (`API_HOST = '127.0.0.1:8777'`)
  - Fix: `import.meta.env.VITE_API_HOST ?? '127.0.0.1:8777'`.

- **[MEDIUM] Movement / random-walk thresholds are inline literals**
  - `backend/core/multi_stop.py:117` (`> 50` first-waypoint distance).
  - `backend/core/random_walk.py:82, 86, 152` (error budgets, backoff cap).
  - `backend/core/movement_loop.py:169` (`asyncio.sleep(0.5 * (attempt + 1))`).
  - `backend/core/simulation_engine.py:420` (`int(time.time() * 1000) & 0x7FFFFFFF`).
  - Fix: promote to module-level named constants (`_FIRST_WAYPOINT_REACH_THRESHOLD_M`, `_MAX_CONSECUTIVE_ERRORS`, `_RECONNECT_BACKOFF_BASE_S`, `_DEFAULT_RANDOM_WALK_SEED_MASK`).

- **[MEDIUM] Frontend visual constants inline**
  - `frontend/src/components/library/BookmarksPanel.tsx:145` (`1e-5` coord match), `:223` (`1200` flash ms), `:536` (`5` visible cap), `:478-480` (`2` stripe).
  - `frontend/src/components/MapView.tsx:323` (`> 500` auto-recenter), `:323` (`latScale = 111320`).
  - Fix: extract `BOOKMARK_MATCH_EPSILON`, `COPIED_FLASH_MS`, `PLACE_CHIPS_VISIBLE_CAP`, `AUTO_RECENTER_THRESHOLD_M`, `METERS_PER_DEGREE_LAT` (latter likely shared with `geo.ts`).

### Tight coupling / leaky abstractions

- **[MEDIUM] `as any` casts: 12 sites, 10 in `MapView.tsx`**
  - File: `frontend/src/components/MapView.tsx` (lines `135, 140, 274, 294, 297, 298, 312, 339, 349, 350`); plus `useSimulation.ts` and `useDevice.ts` (1 each).
  - Most reach into Leaflet private API (`_controlCorners`); the rest cast public methods (`setLatLng`, `setIcon`) that are already typed.
  - Fix: define `type LeafletMapInternal = L.Map & { _controlCorners?: { topleft?: HTMLElement; topright?: HTMLElement } }`, cast once, drop the rest.

- **[MEDIUM] `value` memoization in SimContext gives almost nothing**
  - File: `frontend/src/contexts/SimContext.tsx:576-646`
  - Deps include `sim` and `joystick` whole objects — their identity changes on most state updates → all consumers re-render on every WS event.
  - Fix: deconstruct only the fields the value actually consumes, or split SimContext into focused contexts (state vs handlers vs derived).

- **[MEDIUM] `__init__` of SimulationEngine sets ~25 attributes**
  - File: `backend/core/simulation_engine.py:150-209`
  - Fix: split into a `@dataclass` of "runtime tracking" fields and a separate state container.

- **[MEDIUM] Two effects manage the same Leaflet layer**
  - File: `frontend/src/components/MapView.tsx:108` (reacts to layerKey) and `:119` (initial mount with `[]` deps + `eslint-disable` at `:264`).
  - Race: fast user clicks during initial mount can interleave.
  - Fix: collapse into one effect or guard the layerKey one to no-op until the init effect committed.

### Other functional issues

- **[MEDIUM] WS broadcast is sequential**
  - File: `backend/api/websocket.py:25-35`
  - One slow client blocks all others.
  - Fix: `asyncio.gather` with per-client `asyncio.wait_for(ws.send_text(...), 1.0)` and dead-list pruning.

- **[MEDIUM] `_engine` orchestration function (76 lines, two retry loops, exception walking)**
  - File: `backend/api/location.py:41-116`
  - Fix: split into `_get_or_rebuild_engine`, `_resolve_target_udid`, `_force_reconnect`.

- **[MEDIUM] Saved routes module-level singleton with no isolation**
  - File: `backend/api/route.py:30, 49` (`_saved_routes`, `_saved_routes_lock`)
  - Fix: hide behind a `SavedRoutesStore` class so tests can construct a fresh instance.

- **[MEDIUM] String-match exception classification**
  - File: `backend/api/wifi_tunnel.py:74-75, 162, 254, 257-263`
  - `_msg.lower()` matched against `"PairingDialogResponsePending"`, `"consent"`, `"not paired"`, `"pairingerror"`. Brittle across pymobiledevice3 versions.
  - Fix: match on exception classes from pymobiledevice3.

- **[MEDIUM] No `Bookmark.tags` length cap or uniqueness**
  - File: `backend/models/schemas.py:208`
  - A POST with 10K tags is accepted.
  - Fix: `Field(max_items=64)` and dedupe on write.

---

## LOW Priority

- **[LOW] Inline mouseEnter/Leave style mutation**
  - `frontend/src/components/MapContextMenu.tsx:331-337`, `frontend/src/components/shell/BottomDock.tsx:584-585`, `frontend/src/components/library/BookmarksPanel.tsx` (multiple sites). Direct DOM writes when CSS `:hover` would do.

- **[LOW] Dead `void` retainers**
  - `frontend/src/components/shell/BottomDock.tsx:687-689` — `void Repeat; void Dices; void Plus` to silence unused-import lint. Either use them or remove.

- **[LOW] `_haversine_m = haversine_m` redundant alias**
  - `backend/services/route_service.py:30`.

- **[LOW] Storage-key prefix inconsistency**
  - `frontend/src/lib/storage-keys.ts:15-16` — `gpsController.*` (camelCase) vs everything else `gpscontroller.*`. Comment explains the migration; add a one-shot rename and remove the camelCase entries.

- **[LOW] `SettingsMenu` outside-click uses `mousedown`, not `pointerdown`**
  - `frontend/src/components/shell/SettingsMenu.tsx:84` — touch-based Electron windows may not close.

- **[LOW] Inline imports inside functions**
  - `backend/api/location.py:48-49, 66, 125, 153, 186, 280, 295, 522`; `backend/api/device.py:45, 60, 114, 189, 230, 255`. Pull to top of file for readability.

- **[LOW] `safe_write_json` runs `json.dumps` outside the protected try**
  - `backend/services/json_safe.py:86-124` — a serialisation error short-circuits the cleanup path.

- **[LOW] Export `currentLang()` ignores localStorage failures silently**
  - `frontend/src/services/api.ts:109-115` — Electron sandbox could disable storage; user gets nav-language fallback indefinitely with no log.

- **[LOW] Module side-effect: `DATA_DIR.mkdir()` at import time**
  - `backend/config.py:8` — awkward for tests.

- **[LOW] `pickFields` / parser duplication**
  - `frontend/src/hooks/useSimulation.ts:103-205` — each `parseXxx` has identical asObject / asString / asNumber pull pattern. Adopt Zod (already mandated by the TS rules).

---

## Summary

**Counts:** ~25 HIGH, ~25 MEDIUM, ~10 LOW.

**Top 3 highest-impact fixes:**

1. **Split `useSimulation.ts` (1126 lines) into 7 focused hooks.** This single change unblocks any future change to simulation behaviour, fixes the 12 dead try/catch blocks, isolates the unreachable-`allSettled` bug, and makes the optimistic-state-without-rollback issues testable. Pair with a memoization pass on `SimContext`'s `value` so consumers stop re-rendering on every WS tick.

2. **Standardise the API response envelope and consolidate the two i18n tables.** Adopt `{success, data, error, meta}` per `~/.claude/rules/common/patterns.md`, sweep `backend/api/*.py`, then move all of `ERROR_I18N` from `services/api.ts` into `i18n/strings.ts`. Backend `message` becomes English (or omitted) — `code` is the source of truth, frontend resolves to user locale.

3. **Add a `BookmarkManager` lock + serialise `apply_speed` on the engine.** Both currently mutate shared state without protection. Each is one `asyncio.Lock` away from being safe; both have realistic concurrent-write paths today.

**Overall code health: Needs Attention.** The auth posture and the deliberate care around session-token handling, `secrets.compare_digest`, loopback-only bind, RFC1918-validating WiFi tunnel, and the structured `{code, message}` error envelope all show solid security thinking. There are no XSS sinks, no secrets-in-code, no debt markers. The pain points are concentrated structural rather than security: a few god modules (`useSimulation.ts`, `wifi_tunnel.py`, `simulation_engine.py`), pervasive silent-`pass` error handling on the backend, inconsistent response shapes, two parallel translation tables, and missing locks on shared mutable state. The codebase is well-commented, testable, and the worst issues are addressable without rewrites.
