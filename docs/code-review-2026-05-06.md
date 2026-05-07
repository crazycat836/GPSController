# GPSController — Comprehensive Code Review

**Date:** 2026-05-06
**Branch:** main
**Reviewers:** python-reviewer + typescript-reviewer + architect (parallel agents)
**Scope:** backend (49 Python files, ~10k LOC) + frontend (126 TS/TSX files, ~18k LOC) + cross-cutting

TypeScript build is clean. Backend has 3 unit/integration test files; frontend has 1. All findings cite `path:line`.

---

## HIGH Priority

### Live bugs

**[HIGH] Bug — Electron bridge name mismatch silently breaks "open update link"**
- File: `frontend/src/components/UpdateChecker.tsx:18-39`
- Code references `window.gpscontroller` (lowercase `c`); preload exposes `window.gpsController` (`frontend/electron/preload.js:28`). The optional-chain returns `undefined`, fallback `<a target="_blank">` is then blocked by `setWindowOpenHandler` (`frontend/electron/main.js:153`). Update links silently never open in the system browser in the packaged build.
- Fix: rename to `gpsController` in `UpdateChecker.tsx`.
- DONE (93e83bd)

**[HIGH] Async — `startLoop` / `multiStop` dep arrays churn callbacks on unrelated pause settings**
- File: `frontend/src/hooks/useSimulation.ts:301`, `:323`
- `startLoop` reads only `pauseLoop` but lists `pauseMultiStop` and `pauseRandomWalk`; `multiStop` is the mirror. Both reconstruct on every unrelated pause-settings edit, churning every downstream `SimContext` consumer.
- Fix: trim to the actually-read pause object only.
- DONE (93e83bd)

**[HIGH] Async — Unhandled clipboard rejection in `MiniStatusBar`**
- File: `frontend/src/components/shell/MiniStatusBar.tsx:186`
- `navigator.clipboard.writeText(txt).then(...)` lacks `.catch`. Silent failure on permission denial / non-secure contexts. The shared `copyToClipboard` (`frontend/src/lib/clipboard.ts`) already handles this.
- Fix: call `copyToClipboard(txt)` instead.
- DONE (93e83bd)

**[HIGH] Error handling — Floating promise on `bm.deletePlace`**
- File: `frontend/src/components/library/BookmarksPanel.tsx:450`
- `onDelete={(id) => bm.deletePlace(id)}` returns a Promise but consumer treats as `void`; rejection is silent (no toast/log).
- Fix: wrap in async handler that surfaces failure via toast.
- DONE (93e83bd)

### Security

**[HIGH] Security — CORS `allow_origins=["*"]` on the local API**
- File: `backend/main.py:769-773`
- API binds to loopback, but any browser tab in the user's Chrome/Safari can still issue requests through the user-agent. Legitimate caller is Electron renderer + `localhost:5173` only.
- Fix: `allow_origins=["app://.", "http://localhost:5173", "http://127.0.0.1:5173", "file://"]`.
- DONE (93e83bd)

**[HIGH] Security — Unbounded geocode proxy (Nominatim ToS risk)**
- File: `backend/api/geocode.py:24-40`; `backend/services/geocoding.py:57`, `:123`
- No rate limiting. A frontend bug or local attacker can hammer Nominatim through this proxy and trigger key/IP ban (Nominatim policy mandates ≥1s between requests).
- Fix: per-process `asyncio.Semaphore` + token-bucket throttle in `GeocodingService`.
- DONE (56424a0) — single-slot lock with ≥1.05s spacing serialized across `search`+`reverse`

### Response envelope / error contract

**[HIGH] Response envelope — 10 endpoints emit bare-string `detail=`, breaking the `{code,message}` contract**
- File: `backend/api/bookmarks.py:105`, `:113`, `:177`, `:186`, `:212`, `:219`; `backend/api/route.py:55`, `:70`, `:163`; `backend/api/device.py:224`
- Frontend keys i18n on `error.code` (`frontend/src/services/api.ts:129-145`). Bare strings collapse to generic `http_404` and lose the discriminator.
- Fix: `raise http_err(404, "bookmark_not_found", "...")` (helper already in `backend/api/_errors.py`).
- DONE (0068942) — 11 sites migrated (10 reviewed + bookmarks.py:184 default_place_immutable bonus)

**[HIGH] Error-code / i18n table drift — ~16 backend codes have no `err.<code>` translation**
- Backend code emit sites: `backend/api/_envelope.py:124`, `backend/api/route.py:67-125`, `backend/api/device.py:46-267`, `backend/api/location.py:73-399`, `backend/api/system.py:60-74`, `backend/api/wifi_tunnel.py:182-855`. Frontend lookup: `frontend/src/i18n/strings.ts:278-298`.
- Missing translations: `validation_failed`, `unauthorized`, `invalid_name`, `gpx_too_large`, `gpx_decode_failed`, `invalid_lang`, `device_not_connected`, `ios_version_unsupported`, `usb_required`, `no_active_route`, `open_log_failed`, `tunnel_failed`, `tunnel_no_rsd`, `scan_failed`, `connect_failed`, `forget_failed`, `joystick_start_failed`, `amfi_unavailable`, `amfi_reveal_failed`, `invalid_coord`. Each falls through to raw English `e.message`, defeating bilingual UX.
- Stale entry: `err.tunnel_script_missing` (`strings.ts:279`) — no backend code emits it.
- Fix: contract test (`frontend/tests/contract.test.ts`) walks `STRINGS` map vs. generated registry; add missing translations; remove stale key.
- DONE (0068942 + ec5f312) — 26 missing translations added; stale `err.tunnel_script_missing` removed earlier (93e83bd); ErrorCode(StrEnum) registers all 39 codes so future drift is a TypeError. Frontend contract test still pending — gated on the WS-codegen phase that produces the registry.

### WS message contract

**[HIGH] WS message contract has no shared schema — drift is invisible until runtime**
- Frontend handlers: `frontend/src/hooks/sim/useSimWsDispatcher.ts:290-505`, `frontend/src/hooks/device/useDeviceWs.ts:68-242`. Backend emit sites spread across `backend/main.py:428,583,626,690`, `backend/api/device.py:54,108,190`, `backend/api/wifi_tunnel.py:294,586,635,655,667,747`, `backend/api/location.py:184`, `backend/services/cooldown.py:128`, plus all `engine._emit(...)` in `backend/core/*.py`.
- **Dead handlers:** Frontend handles `device_reconnected` at `useDeviceWs.ts:224-241` and `useSimWsDispatcher.ts:458-462`, but no backend code emits it (watchdog now broadcasts `device_connected`).
- **Dropped events:** Backend emits but frontend ignores: `tunnel_degraded`, `tunnel_recovered`, `connection_lost`, `device_error`, `random_walk_arrived`, `random_walk_complete`, `navigation_complete`, `multi_stop_complete`, `stop_reached`, `dual_sync_start`, `restored`, `teleport`. `tunnel_degraded`/`tunnel_recovered`/`connection_lost` carry user-actionable info silently dropped.
- Fix: `backend/models/ws_events.py` (Pydantic per event) → `tools/gen_ts_types.py` step in `build.py` stage 0 → `frontend/src/generated/api-contract.ts`.

### Module boundary leaks

**[HIGH] `core/` imports from `api/` (layer-violation cycle)**
- File: `backend/core/tunnel_liveness.py:40` imports `_cleanup_wifi_connections, _tcp_probe, _tunnel` from `backend/api/wifi_tunnel.py`. Comment at `:37` admits the lazy-import workaround.
- File: `backend/core/ddi_mount.py:49`, `:107`, `:149`, `:196`, `:213` repeats `from api.websocket import broadcast`.
- Architectural intent is `api/ → core/ → services/` (matches `main.py` layout). Cleanup helper, TCP probe, and broadcast fan-out are transport/business primitives that belong below `api/`.
- Fix: extract `broadcast` → `services/ws_broadcaster.py`; move `_cleanup_wifi_connections`/`_tcp_probe`/`TunnelRunner` accessors → `services/wifi_tunnel_service.py`. Add a pre-commit lint `tools/check_layers.py` that fails on `from api.` inside `core/` or `services/`.
- DONE (e2e41fc) — both services created, 17 broadcast call sites migrated, lazy-import workaround in core/tunnel_liveness.py:40 removed, lint added (currently passes; pre-commit wiring deferred to CI phase)

**[HIGH] API layer reaches into private internals**
- File: `backend/api/device.py:13` (imports `_parse_ios_version`); `backend/api/location.py:554`, `:562` (calls `cd._emit()`); `backend/api/location.py:591`, `:624` (touches `app_state._initial_map_position`, `._last_position`)
- Fix: rename to public APIs (`parse_ios_version`, `cd.notify()`, `app_state.get_last_position()`).
- DONE (6146632) — also added `app_state.get_initial_map_position()` for the persisted-only getter

### DRY violations

**[HIGH] DRY — `UnsupportedIosVersionError` handler duplicated verbatim**
- File: `backend/api/device.py:66-79`; `backend/api/wifi_tunnel.py:312-325`
- Identical 10-line `except` block in two places.
- Fix: extract to `backend/api/_errors.py` helper.
- DONE (60ac7fa) — `ios_unsupported_error(version)` in `_errors.py`

**[HIGH] DRY — `max_devices_reached` 409 raised at three sites**
- File: `backend/api/device.py:43-47`; `backend/api/wifi_tunnel.py:285-288`, `:853-856`
- Fix: single helper `_max_devices_error()`.
- DONE (60ac7fa) — `max_devices_error()` in `_errors.py` (public, not underscore)

**[HIGH] DRY — Speed-profile resolution duplicated across three movement modes**
- File: `backend/core/route_loop.py:105-109`; `backend/core/multi_stop.py:99-106`; `backend/core/random_walk.py:252-265`
- Three independent implementations of "honor `apply_speed` then re-pick from args".
- Fix: hoist to `SimulationEngine.pick_speed_profile(...)` or free function in `backend/core/movement_loop.py`.
- DONE (60ac7fa) — added as `SimulationEngine.pick_speed_profile`

**[HIGH] DRY — Pause-clamping (`sorted` + negative guard + `random.uniform`) triplicated**
- File: `backend/core/route_loop.py:122-124`; `backend/core/multi_stop.py:40-43`; `backend/core/random_walk.py:322-326`
- Fix: shared helper in `backend/config.py` or `backend/core/utils.py`.
- DONE (60ac7fa) — `clamp_pause_range(min, max)` in `config.py`; each caller still owns the "skip if hi<=0" + RNG choice

### Architecture / file size

**[HIGH] File size — `backend/main.py` is 882 lines with 3 distinct responsibilities**
- File: `backend/main.py:190-496` (`AppState` ~310 lines), `:503-645` (`_usbmux_presence_watchdog` ~140 lines), `:1-188` (logging setup). `_sync_new_device_to_primary` alone is 110 lines (`:387-495`).
- Fix: extract `AppState` → `backend/state.py`; watchdog + dual-sync → `backend/services/device_watchdog.py`; logging → `backend/logging_config.py`. Result: <300 lines.

**[HIGH] File size — `backend/api/wifi_tunnel.py` is 875 lines mixing scan/pair/lifecycle**
- File: `backend/api/wifi_tunnel.py:1-875` — discovery (`_scan_subnet_for_port`, `_resolve_hostname`, `wifi_tunnel_discover`), RemotePairing handshake (`_perform_remote_pair_handshake`, `_close_remote_pair_resources`, `wifi_repair`), tunnel lifecycle (`wifi_tunnel_start`, `wifi_tunnel_stop`, `_tunnel_watchdog`).
- Fix: split into `services/wifi_discovery.py` + `services/wifi_repair.py` + `services/wifi_tunnel_lifecycle.py`; keep router thin.

**[HIGH] Architecture — `SimContext.tsx` is an 810-line "god context"**
- File: `frontend/src/contexts/SimContext.tsx:106-146` (the `SimContextValue` interface; comment at `:703-710` already acknowledges)
- Every consumer re-renders on every position-tick. The `SimDerivedContext` pattern is already in place — extend it.
- Fix: split into stable-handlers context (rarely changes) + reactive-state context. Pull cooldown subscriber (`:634-654`) into `useCooldownSync` hook; per-mode action functions into `frontend/src/contexts/sim/actions.ts`.

### Performance

**[HIGH] Async — `httpx.AsyncClient` recreated per request**
- File: `backend/services/geocoding.py:57`, `:123`; `backend/services/route_service.py:189`
- Every geocode and OSRM call pays full TCP+TLS handshake. Compounds during 10 Hz navigation.
- Fix: lifespan-scoped `AsyncClient`.
- DONE (56424a0) — module-level lazy client + `close_client()` wired to FastAPI lifespan shutdown for both services

**[HIGH] Async — Default executor for `socket.gethostbyaddr` in /24 scan**
- File: `backend/api/wifi_tunnel.py:482`
- 253 concurrent `run_in_executor(None, ...)` calls saturate the default thread pool.
- Fix: dedicated `ThreadPoolExecutor(max_workers=16)` or separate `asyncio.Semaphore` for DNS.
- DONE (56424a0) — module-level `_DNS_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="wifi-dns")`

### Project structure

**[HIGH] Three orphan/quasi-duplicate `wifi_tunnel.py` files — root-level script is dead code**
- File: `wifi_tunnel.py:1-159` (root) — standalone CLI never invoked anywhere (verified via grep — `start.py`, `build.py`, `main.py`, Electron main, API never reference it).
- Live implementations: `backend/core/wifi_tunnel.py` (`TunnelRunner`) + `backend/api/wifi_tunnel.py` (routes). Correctly layered.
- Three files with same name guarantees future devs edit the wrong one.
- Fix: delete root `wifi_tunnel.py` and the dead `err.tunnel_script_missing` translation (`frontend/src/i18n/strings.ts:279`). If standalone CLI is desired for debugging, move to `tools/wifi_tunnel_cli.py`.
- DONE (93e83bd) — root file deleted, stale i18n key removed; CLI not relocated (no debugging need yet)

### Test coverage

**[HIGH] Frontend has effectively zero test coverage**
- Frontend: only `frontend/src/lib/connectionHealth.test.ts` exists. 1 test file across ~120 source files. Vitest (`frontend/package.json:38`) is wired but unused.
- Backend: 3 test files (`backend/tests/test_bookmarks_migration.py`, `test_json_safe_sudo.py`, `test_tunnel_liveness.py`).
- Critical untested paths: response-envelope unwrap (`frontend/src/services/api.ts:212-237`), WS dispatch (`useSimWsDispatcher.ts:282-507`, ~24 events), device WS (`useDeviceWs.ts:68-244`), error code → i18n (`api.ts:129-145`).
- No CI: `.github/workflows/` does not exist. Project rules require ≥80% coverage.
- Fix: add Vitest tests for WS dispatcher, envelope parser, parsers; Playwright smoke for connect → teleport → restore; `.github/workflows/ci.yml`.

### Documentation drift

**[HIGH] Documented stack drifted from `package.json`**
- File: `README.md:191`, `README.en.md:189` claim Electron 41, React 18.3, TypeScript 5.5, Vite 8.
- Actual (`frontend/package.json:24-37`): React ^19.2.5, TypeScript ^6.0.3, Electron ^41.3.0, Vite ^8.0.10. React 18→19 and TS 5→6 are major-version bumps.
- Fix: update README tables; add a CI test asserting `package.json.dependencies.react` startsWith `19.`.
- DONE (93e83bd) — README tables updated to React 19 / TypeScript 6; CI assertion deferred until Phase covering CI lands

### TypeScript correctness

**[HIGH] TS — Explicit `any` in `SearchBar.doSearch`**
- File: `frontend/src/components/shell/SearchBar.tsx:51`
- `(r: any) => …` opts out of typing despite `searchAddress` already returning `AddressSearchResult[]`.
- Fix: drop the annotation.
- DONE (93e83bd) — annotation dropped; also removed dead `r.name` / `r.address` fallbacks (search endpoint never returns those)

**[HIGH] TS — `import.meta` re-cast through `unknown` to reach `env.DEV`**
- File: `frontend/src/contexts/SimContext.tsx:250`
- Inconsistent with rest of codebase (e.g., `useSimulation.ts:502`) which uses `import.meta.env.DEV` directly via Vite types.
- Fix: drop the cast.
- DONE (93e83bd)

---

## MEDIUM Priority

### Backend

**[MEDIUM] Dead import — `traceback` in `backend/api/location.py:3`** (never used).

**[MEDIUM] Duplicate `import asyncio`** at `backend/main.py:521`, `:649`; `backend/core/device_manager.py:538` (already imported at module top).

**[MEDIUM] Legacy typing — mixed `Dict`/`Optional` with `from __future__ import annotations`**
- File: `backend/core/device_manager.py:25`, `:72-81`, `:114`. Inconsistent with rest of codebase.
- Fix: migrate to `dict[]` / `X | None`.

**[MEDIUM] DRY — `_get_local_ip()` reimplemented twice with identical UDP-probe trick**
- File: `backend/api/wifi_tunnel.py:408-419`; `backend/core/device_manager.py:759-774`
- Fix: hoist to `backend/utils/net.py`.

**[MEDIUM] Error handling — silent legacy-data-dir migration**
- File: `backend/main.py:49-50` — `except OSError: pass`. A permissions bug silently loses persistent settings.
- Fix: `logger.debug("legacy rename failed: %s", exc)`.

**[MEDIUM] Magic constants buried in modules instead of `config.py`**
- `backend/api/wifi_tunnel.py:459`, `:522`, `:526-528` (`49152` RemotePairing port)
- `backend/services/location_service.py:190` (`[0.5, 1.5, 3.0, 4.0, 6.0]` reconnect delays)
- `backend/api/websocket.py:19`, `:27` (`_WS_AUTH_TIMEOUT_SECONDS`, `_BROADCAST_PER_CLIENT_TIMEOUT_S`)

**[MEDIUM] Naming — local `_log = logging.getLogger("gpscontroller")` shadows module logger**
- File: `backend/api/location.py:53`, `:83`. Use module-level `logger`.

**[MEDIUM] Type — public function missing return type**
- File: `backend/api/wifi_tunnel.py:41` — `_run_teardown_steps` returns `list[dict[str, str]]` but undeclared.

**[MEDIUM] Documentation — Nominatim failure semantics undocumented**
- File: `backend/api/geocode.py:39` — `search`/`reverse` return `[]`/`None` on upstream failure, not 5xx. Frontend has to infer.

**[MEDIUM] Centralised broadcasting needed — `event_type` strings as bare literals across 7 files**
- Sites: `backend/main.py:428,583,626,690`, `backend/api/device.py:54,108,190`, `backend/api/wifi_tunnel.py:294,586,635,655,667,747`, `backend/api/location.py:184`, `backend/services/cooldown.py:128`, plus 5 sites in `core/ddi_mount.py` and every `engine._emit` in `core/*`.
- Typo `"deivce_disconnected"` would silently drop events for the lifetime of the app.
- Fix: typed helpers in `backend/services/ws_events.py` — `broadcast_device_disconnected(udids, reason, cause)` etc.

**[MEDIUM] `/api/location/debug` exposes internal state**
- File: `backend/api/location.py:512-526`. Returns `engine.state`, `_active` private attr (via `getattr`). Token-protected, but should be dev-only.
- Fix: gate behind `if _is_auth_disabled():` or remove.

**[MEDIUM] Two sources of truth for tunnel default port**
- File: `frontend/src/services/api.ts:266` `DEFAULT_TUNNEL_PORT = 49152`; backend `backend/api/wifi_tunnel.py:399` `49152`.
- Fix: surface via `/api/system/constants` or comment-link.

### Frontend

**[MEDIUM] DRY — Three identical fetch-then-refresh handlers in `BookmarkContext`**
- File: `frontend/src/contexts/BookmarkContext.tsx:125-167` — `handleRouteSave`, `handleRouteRename`, `handleRouteDelete`.
- Fix: extract `refreshRoutes` callback.

**[MEDIUM] React — non-null assertion on `editing.bookmark!.id`**
- File: `frontend/src/components/library/BookmarksPanel.tsx:440`
- Fix: capture `const bk = editing.bookmark; if (!bk) return;`.

**[MEDIUM] Performance — `renderBookmarkRow` is a closure recreated every render**
- File: `frontend/src/components/library/BookmarksPanel.tsx:328`
- Closes over many state vars. With 500-item lists, typing in search re-renders every row.
- Fix: extract `BookmarkRowRenderer` as a memoized component.

**[MEDIUM] React — mutation inside `useMemo` (`buckets.get(key)!.push(b)`)**
- File: `frontend/src/components/library/BookmarksPanel.tsx:120`
- Fix: `buckets.set(key, [...(buckets.get(key) ?? []), b])`.

**[MEDIUM] Module-level mutable state without doc**
- File: `frontend/src/services/api.ts:87` (`warnedLocalStorage`), `:162` (`authTokenPromise`). Test-isolation pitfall.

**[MEDIUM] Idiomatic — non-memoized `handleInput`/`handleSelect`**
- File: `frontend/src/components/shell/SearchBar.tsx:65-82`. Inconsistent with `doSearch` which is `useCallback`.

**[MEDIUM] Magic number — `useState(5)` for default waypoint count**
- File: `frontend/src/contexts/SimContext.tsx:239`. Should be `DEFAULT_WP_GEN_COUNT` in `frontend/src/lib/constants.ts`.

**[MEDIUM] Type alias declared inside callback body**
- File: `frontend/src/contexts/SimContext.tsx:292` (`type Pt = ...`). Hoist to module scope.

**[MEDIUM] Error handling — cooldown initial fetch swallowed**
- File: `frontend/src/contexts/SimContext.tsx:641` — `.catch(() => {})` hides slow-backend startup.
- Fix: `devWarn` in catch.

**[MEDIUM] `SimContext` reaches around `services/api.ts` for WS payload typing**
- File: `frontend/src/contexts/SimContext.tsx:646` casts inline `{ remaining_seconds?, enabled? }` instead of importing `CooldownStatusResponse` from `frontend/src/services/api.ts:339-345`.
- Two parallel definitions for the same Pydantic model.

### Cross-cutting

**[MEDIUM] No CI configuration**
- `.github/workflows/` does not exist. `tsc`, `vitest`, `pytest`, build chain only run on developer machine. No automated guarantee a commit even compiles before tag.
- Fix: `.github/workflows/ci.yml` with `frontend-check`, `backend-check`, `cross-check` (i18n key drift).

---

## LOW Priority

**[LOW] Naming clash — `backend/api/wifi_tunnel.py` vs `backend/core/wifi_tunnel.py`** (and removed root `wifi_tunnel.py`). Rename `api/wifi_tunnel.py` → `api/tunnel_router.py`.

**[LOW] PEP-8 — Missing `from __future__ import annotations` in `backend/api/{location,device,bookmarks,route,websocket,system}.py`** — they use `X | None` directly; pinned on 3.10 unnecessarily.

**[LOW] `shell=True` for trusted Windows pipeline** — `start.py:76`, `stop.py:16`. No user input but worth a comment.

**[LOW] DRY — Avatar button hand-rolls `SettingsRow` styles**
- File: `frontend/src/components/shell/SettingsMenu.tsx:245-279`. Use existing `SettingsRow` component.

**[LOW] React keys — `key={i}` in `BulkCoordsDialog` error list**
- File: `frontend/src/components/library/BulkCoordsDialog.tsx:145`. Use `${err.line}-${err.reason}`.

**[LOW] Unnecessary type cast on `package.json`**
- File: `frontend/src/components/UpdateChecker.tsx:3-7`, `frontend/src/components/shell/SettingsMenu.tsx:17-19`. With `resolveJsonModule`, the cast is dead weight.

**[LOW] Console — bare `console.warn` instead of `devWarn`**
- File: `frontend/src/contexts/SimContext.tsx:253`; `frontend/src/hooks/useSimulation.ts:506-510`.

**[LOW] Re-annotated `_handlers` list trips `mypy --warn-unreachable`**
- File: `backend/main.py:120`, `:122`. Annotate once before `try`.

**[LOW] Dead `from typing import Callable` runtime import**
- File: `backend/core/multi_stop.py:8`. Only used in stringified annotations.

**[LOW] `EnvelopeJSONResponse` bypass mechanism is implicit**
- File: `backend/api/_envelope.py:63-75`. Future endpoint that returns dict with `success`+`data` keys would unintentionally bypass wrapping. Add unit test.

**[LOW] `version.py` reads `frontend/package.json` at every import**
- File: `backend/version.py:26-39`. Cache with `functools.lru_cache(maxsize=1)`.

**[LOW] Root-level `start.py`/`stop.py` use port literals instead of `backend/config.py`**
- Files: `start.py:25-26`, `stop.py:12`. Backend canonical at `backend/config.py:111`. Three files in lockstep.

**[LOW] `backend/api/wifi_tunnel.py:835-874` calls route handler `wifi_tunnel_start(req)` directly**
- Blurs routing layer. Extract to `_do_start(req)` helper.

**[LOW] `SimErrorCode` covers tiny subset of backend codes**
- File: `frontend/src/hooks/sim/useSimWsDispatcher.ts:222`. Two parallel error taxonomies for same domain.
- Fix: unify under `BackendErrorCode` discriminated union derived from generated types.

**[LOW] `backend/main.py:299-307` setter writes to magic `"__legacy__"` key**
- Comment says "Best-effort: stash under a synthetic key if udid unknown". Migration started but not finished.
- Fix: grep last caller, migrate, delete.

**[LOW] `backend/api/_errors.py` lacks an `ErrorCode` enum**
- 17-line file accepts any string for `code`. Source of i18n drift.
- Fix: `class ErrorCode(StrEnum)`; refactor ~23 call sites.
- DONE (ec5f312) — 39 codes enumerated, 28 sites migrated, `http_err` signature tightened to `code: ErrorCode`

**[LOW] `tools/terminal_ui.py` exports underscore-prefixed names imported by sibling scripts**
- Files: `tools/terminal_ui.py:13`, `:29`, `:35` — `_visual_width`, `_box_line`, `_box_border`. Imported by `start.py:23`, `build.py:44`.
- Fix: drop the underscore prefix.

---

## Summary

| Priority | Count |
|----------|------:|
| HIGH     | 26    |
| MEDIUM   | 21    |
| LOW      | 16    |
| **Total**| **63**|

### Top 5 Most Impactful Improvements

1. **Generate a shared TypeScript type file from backend Pydantic models + WS event registry.** Eliminates the i18n drift (~16 missing `err.*` codes), the dead `device_reconnected` handler, the orphaned `tunnel_degraded` / `connection_lost` events, and the parallel `CooldownStatusResponse` shape definitions. Define WS events in `backend/models/ws_events.py`, add `tools/gen_ts_types.py` step in `build.py` stage 0, output to `frontend/src/generated/api-contract.ts`. Run in CI; commit the diff — drift becomes a PR conversation, not a runtime mystery.

2. **Repair the response-envelope contract.** 10 endpoints in `backend/api/bookmarks.py`, `backend/api/route.py`, `backend/api/device.py:224` collapse to generic `http_404`. Highest user-visible-correctness leverage; one-helper fix.

3. **Centralise broadcasting and error helpers in `services/`, then enforce the layer rule with a lint check.** Move `broadcast` → `services/ws_broadcaster.py`. Move `_cleanup_wifi_connections`/`_tcp_probe`/`TunnelRunner` accessors → `services/wifi_tunnel_service.py`. Add `tools/check_layers.py` pre-commit that fails on `from api.` inside `core/` or `services/`. Removes the inline-import workarounds at `core/tunnel_liveness.py:37` and the four sites in `core/ddi_mount.py`.

4. **Split the three god files.** `backend/main.py` (882) → extract `AppState` + watchdog + logging. `backend/api/wifi_tunnel.py` (875) → discovery + repair + lifecycle services. `frontend/src/contexts/SimContext.tsx` (810) → handlers context + state context. After split, all land <500 lines.

5. **Stand up frontend testing as a first-class workflow + CI.** Vitest is already a dependency; `npm test` runs one test. Add: parser-boundary tests for `frontend/src/hooks/device/parsers.ts`, snapshot tests for `useSimWsDispatcher` reducers, Playwright smoke for connect → teleport → restore. Wire `npm run build && npm test` and `pytest backend/tests` into `.github/workflows/ci.yml`.

### Overall Code Health: **Needs Attention**

- **Bones are good:** clear `api`/`core`/`services` split, consistent envelope helper exists, generally well-typed, lazy-import workarounds are at least honestly commented.
- **Maintainability debt clusters in three places:** the four >800-line files, the WS contract with no shared schema, and the i18n table that has silently drifted from backend codes.
- **One live runtime bug** (Electron bridge name) and **one CORS-loose default** are the only items that would fail a security/correctness gate; everything else is maintainability and consistency.
- **Test coverage is the structural blocker** — frontend has effectively zero coverage and no CI runs `tsc`/`pytest`/`vitest` on push.
