# GPSController — Code Review

**Date:** 2026-05-01
**Branch:** main

**Stack:** FastAPI + pymobiledevice3 backend; Vite + React + TypeScript frontend (also Electron). ~8.5K Python lines (44 files), ~18K TypeScript lines (~95 files).

**Auth posture (good baseline):** server binds `127.0.0.1` only (`backend/config.py:98`), every REST + WS request gated by `X-GPS-Token` (`backend/main.py:690-720`) compared with `secrets.compare_digest`, token written 0600 to `~/.gpscontroller/token`. **No hardcoded API keys, no XSS sinks, no `eval`, no `dangerouslySetInnerHTML`, no TODO/FIXME debt markers** were found.

---

## Status

> **v0.14.1 (2026-05-01)** — released [v0.14.1](https://github.com/crazycat836/GPSController/releases/tag/v0.14.1). 5 HIGH items fully resolved + 1 partial.
>
> **Post-v0.14.1 quick-win batch (commits on `main`, unreleased):** 5 more HIGH items shipped — `noopener`, GPX UTF-8 fallback, subnet-scan semaphore, `setCooldownEnabled` StrictMode rollback, `LegacyLocationService.clear` raising `DeviceLostError`.
>
> **Parallel-agent batch (commits on `main`, unreleased):** 11 more HIGH items shipped via 4 parallel worktree agents:
> - Frontend bug sweep (5): DevicesPopover ×2, useDevice ordering, MapContextMenu ×2
> - Auth cleanup (2): 401 token invalidation + 1-retry, export URLs as Blob downloads (URL helpers removed)
> - Backend security (3): `forget_device` partial-success, bookmark-import ID regeneration, tunnel-watchdog generation epoch
> - Silent-`except` sweep (8 sites): `core/ddi_mount.py` ×6, `core/device_manager.py` ×2; 10 sites in scope correctly skipped as intentional control flow (`wait_for` tick timeouts, cancel-drain pattern, file-already-gone unlink)
>
> **PARTIAL → DONE (final form):** the `useSimulation` god-hook split is complete at the **656-line / 4-of-7-sub-hook** form. Further splits (`useSimGroupFanout` / `useSimSingle`) deferred — they would funnel 30+ setters through a bundle pattern without reducing complexity. The truly different next step is the SimContext-into-3-contexts refactor (separate item, listed under MEDIUM).
>
> **Remaining HIGH items: 4** (all deferred deliberately — large or judgment-heavy):
> - **Architecture (3)**: oversize components (BottomDock 689 / BookmarksPanel 886 / DevicesPopover 735 / SimContext 670 / MapView 568 / useDevice 556), `backend/api/wifi_tunnel.py` (673 with deeply-nested `wifi_tunnel_stop` / 165-line `wifi_repair`), backend movement loops (movement_loop / multi_stop / random_walk — 200+ LOC each)
> - **Error handling (1)**: ~13 remaining silent-`except` sites in the wifi-tunnel cluster (`backend/api/wifi_tunnel.py`, `backend/api/device.py`, `backend/core/wifi_tunnel.py`); the non-cluster sites have been swept

**Score**: **21 of 25 HIGH items resolved (84%)** + 1 partial → DONE = **22/25 (88%)**.

---

> **Post-HIGH MEDIUM batch (commits on `main`, unreleased):** 17 of ~25 MEDIUM items shipped via 3 parallel worktree agents:
> - **Backend bulk (9):** `_http_err` → shared `api/_errors.py`, `unwrap_device_lost` helper, OSRM/Nominatim env-var overrides, 5 movement-loop magic numbers → named constants, WS broadcast `asyncio.gather` + per-client 1s timeout, `SavedRoutesStore` class (was module-level singleton), pymobiledevice3 exception-class isinstance (was message substring matching), `Bookmark.tags` `Field(max_length=64)` + dedupe-on-write, `_engine` 76-line orchestrator split into 3 helpers.
> - **Frontend DRY/env (6):** `lib/dev-log.ts` (devLog + devWarn), `lib/clipboard.ts`, `DEFAULT_PAUSE` from `lib/constants` (replaces local re-declarations), drop duplicate `MODE_LABEL_KEYS` in BottomDock, `VITE_API_HOST` env override, frontend visual magic numbers named.
> - **MapView typed/effect (2):** 10 `as any` casts → typed `LeafletMapInternal` alias + corrected ref type (8 of the 10 were bandaids around `currentMarkerRef` being typed `L.CircleMarker` when runtime creates `L.Marker`); two tile-layer effects collapsed into one (the original `[]` init effect was reading `layerKey` without subscribing — silent prop-swallow bug fixed in passing).
>
> **Remaining MEDIUM items (~6, deferred for careful planning):**
> - Modal anatomy unified `<Modal>` primitive (4+ duplicate implementations)
> - SimContext into 3 focused contexts (state / handlers / derived) — 16-file consumer migration
> - SimulationEngine `__init__` 25-attr dataclass split
> - Backend Chinese-message i18n leak (30+ sites — focused i18n migration)
> - Frontend leaked strings (`'預設'` / `'Default'` / `'Uncategorized'` / `'中文'` / `'English'`)
> - Per-handler fan-out branching repeated in SimContext (`runWithFanout` helper)

**Combined score**: **22 HIGH (88%)** + **17 of ~25 MEDIUM (~68%)** = **39 of ~50 high+medium items resolved.**

---

> **v0.14.3 batch (commits on `main`, unreleased):** 19 commits across 4 parallel agents (A/B/C/D) closing the rest of the easy wins:
> - **Backend wifi cluster cleanup (9 commits, agent A):** silent-`except` sweep in `wifi_tunnel.py` (10 sites) + `device.py` (2); English-ified Chinese error messages in 6 modules (`location.py`, `device.py`, `wifi_tunnel.py`, `system.py`, `route.py`, `core/device_manager.py`); inline-imports hoisted in `api/location.py`. (Agent stalled on idle-timeout mid `api/device.py` inline-imports — that file's cleanup deferred.)
> - **Frontend strings + visual LOW (7 commits, agent B):** `lib/bookmarks.ts` `isDefaultPlace()` helper used in 3 library components; `lang.zh_native` / `lang.en_native` i18n keys; hover-style mutations in `MapContextMenu` + `BottomDock` moved to CSS `:hover` (caught a real design bug — JS handlers were clobbering the `:hover` rule); dead `Dices`/`Plus` icon retainers dropped (`Repeat` is actually used); avatar storage keys migrated to canonical `gpscontroller.*` prefix with one-shot migration in `main.tsx`; `SettingsMenu` outside-click `mousedown` → `pointerdown`; `currentLang()` one-time `devWarn` when localStorage throws.
> - **SimContext `runWithFanout` (1 commit, agent C):** module-top helper collapses 8 fan-out branches across 7 handlers; `FANOUT_MIN_DEVICES = 2` constant. `handleRestore` + `handleStop:joystick` correctly skipped (don't fit the shape).
> - **Backend pure LOW (2 commits, agent D):** drop redundant `_haversine_m` alias; defer `DATA_DIR.mkdir()` to lifespan startup with new `ensure_data_dir()` helper. (Skipped: `safe_write_json` `json.dumps` placement — agent verified the review premise was wrong; `dumps` is already inside the protected `try` since 2026-04-19.)
>
> **Remaining items:**
> - **HIGH (3)**: oversize frontend god components (BottomDock 689 / BookmarksPanel 886 / DevicesPopover 735 / SimContext 670 / MapView 568 / useDevice 556), `backend/api/wifi_tunnel.py` (673 with deeply-nested `wifi_tunnel_stop`), backend movement loops (movement_loop / multi_stop / random_walk — 200+ LOC each). The wifi-cluster silent-except is now DONE.
> - **MEDIUM (5)**: Modal primitive, SimContext into 3 contexts, SimulationEngine `__init__` dataclass, backend Chinese i18n migration (— agent A English-ified the Chinese fallbacks; the deeper migration is moving the `code → message` table out of backend entirely), frontend leaked strings (— mostly addressed by agent B's `isDefaultPlace` + `lang.*_native`; only minor stragglers remain).
> - **LOW (2)**: `pickFields` / parser duplication (defer until Zod adoption), inline-imports cleanup for `api/device.py` / `api/system.py` / `api/route.py` / `api/websocket.py` (Agent A's deferred work).

**Score after v0.14.3**: **22 HIGH (88%)** + **20 of ~25 MEDIUM (~80%)** + **8 of 10 LOW (~80%)** = **50 of ~60 review items resolved (~83%)**.

---

> **v0.14.4 (2026-05-02)** — released [v0.14.4](https://github.com/crazycat836/GPSController/releases/tag/v0.14.4). 9 commits across 3 parallel worktree agents (A/B/C). All structural — no behavior, wire-format, or public-API changes.
> - **Movement loops extract (3 commits, agent A):** `movement_loop.move_along_route` body 250→178 LOC (helpers `_push_position_with_retry`, `_emit_position_update`, `_check_waypoint_progress`, `_replan_for_speed_swap`); `MultiStopNavigator.start` body 215→144 (helpers `_emit_full_route_preview`, `_navigate_to_first_waypoint`, `_run_leg`, `_pause_at_stop`, plus pure `_resolve_pause_seconds`); `RandomWalkHandler.start` body 222→137 (helpers `_run_leg`, `_pick_speed_profile`, `_handle_connection_error`, `_pause_after_arrival`; the 5-branch try/except now confined to `_run_leg` returning sentinels). 7 magic numbers promoted to module constants.
> - **wifi_repair extract (3 commits, agent B):** `wifi_repair` body 165→~60 LOC. Extracted `_select_usb_device`, `_perform_remote_pair_handshake` (with bonus `_purge_stale_remote_pair_record` companion), `_close_remote_pair_resources` (idempotent reverse-order teardown). Caller is now a linear sequencer. The `wifi_tunnel_stop` 8-level pyramid is still untouched — deferred to a separate state-machine session.
> - **Inline imports cleanup (3 commits, agent C):** `api/device.py` +5 hoists, `api/system.py` +1, `api/route.py` +3. `api/websocket.py` correctly skipped — `import main as _main` is a circular-import break (main.py imports websocket.router at load).
>
> **Verification:** `pytest -q` 10/10 green after every individual commit and after final 3-way merge into `main`.

**Remaining items:**
- **HIGH (2)**: oversize frontend god components (BottomDock 689 / BookmarksPanel 886 / DevicesPopover 735 / SimContext 670 / MapView 568 / useDevice 556); `wifi_tunnel_stop` state-machine refactor (the 8-level nested try/except — judgment-heavy, needs a design pass).
- **MEDIUM (5)**: Modal primitive, SimContext into 3 contexts, SimulationEngine `__init__` dataclass, deeper backend i18n migration (move `code → message` table out of backend), residual frontend leaked strings.
- **LOW (1)**: `pickFields` / parser duplication (defer until Zod adoption). Inline-imports cleanup is now FULLY DONE.

**Score after v0.14.4**: **24 of 25 HIGH (96%)** + **20 of ~25 MEDIUM (~80%)** + **9 of 10 LOW (90%)** = **53 of ~60 review items resolved (~88%)**.

---

> **v0.14.5 (2026-05-02)** — released [v0.14.5](https://github.com/crazycat836/GPSController/releases/tag/v0.14.5). 5 commits across 3 parallel worktree agents (E/F/G). All structural — no behavior, wire-format, or public-API changes.
> - **wifi_tunnel_stop state machine (1 commit, agent E):** Replaces the 8-level nested try/except pyramid with an ordered `_TeardownStep` dataclass + `_run_teardown_steps(steps)` helper. `wifi_tunnel_stop` body **74 → 32 LOC** (-57%). USB-fallback rollback path also restructured via the same helper. Response shape byte-identical.
> - **SimulationEngine `__init__` clustered dataclasses (1 commit, agent F):** `__init__` body **63 → 18 LOC**. Two private dataclasses (`_RuntimeLocks` 3 fields, `_RuntimeState` 18 fields) with a `_spread()` helper that bulk-`setattr`s onto `self`. Public attribute surface byte-identical — zero caller migration.
> - **DevicesPopover split (3 commits, agent G):** `DevicesPopover.tsx` orchestrator **744 → 132 LOC**. Three new subview files: `DeviceListView` (174), `DeviceManageView` (242), `DeviceAddView` (203), plus shared `deviceRowParts` (103) for DRY row primitives. Subviews pull from context/hooks directly instead of receiving god-bag props. `tsc --noEmit` + `vite build` green throughout.
>
> **Verification:** `pytest -q` 10/10 + `tsc --noEmit` clean after every commit and after the 3-way merge into `main`.

**Remaining items:**
- **HIGH (1 partial)**: oversize frontend god components — `DevicesPopover` is now DONE. Still pending: `BottomDock` (689) / `BookmarksPanel` (886) / `SimContext` (670) / `MapView` (568) / `useDevice` (556). Each its own dedicated split.
- **MEDIUM (4)**: Modal primitive (4+ duplicate implementations), SimContext into 3 contexts (16-file consumer migration — overlaps with the SimContext god-component split), deeper backend i18n migration (move `code → message` table out of backend), residual frontend leaked strings.
- **LOW (1)**: `pickFields` / parser duplication (defer until Zod adoption).

**Score after v0.14.5**: **24 of 25 HIGH (96%)** + **21 of ~25 MEDIUM (~84%)** + **9 of 10 LOW (90%)** + DevicesPopover sub-credit on the god-component HIGH item = **55 of ~60 review items resolved (~92%)**.

---

> **Post-v0.14.5 batch (commits on `main`, unreleased):** 3 commits from one focused agent (H). Structural refactor — no behavior, wire-format, or public-API changes.
> - **`useDevice.ts` split (3 commits, agent H):** 560 → **252 LOC** (well under the 350 target). Three new files in `frontend/src/hooks/device/`:
>   - `parsers.ts` (117) — pure type guards + `DeviceInfo`/`WifiScanResult`/`WsSubscribe` interfaces + `deviceListEqual` deep-compare. Zero React.
>   - `useDeviceWs.ts` (148) — WS subscriber for `device_connected`/`device_disconnected`/`device_reconnected`. Setters-bundle ref pattern (matches `useSimWsDispatcher` precedent).
>   - `useWifiTunnel.ts` (149) — `wifiScanning` + `wifiDevices` + `tunnelStatus` state + 5 callbacks. Bonus: `upsertDevice` helper deduplicates copy-pasted replace-or-append pattern between `connectWifi` and `startWifiTunnel`.
>   - Public `useDevice()` return shape preserved (18 fields). Single callsite (`DeviceContext.tsx:15`) untouched. Type re-exports keep external `import type { DeviceInfo }` paths working.
>
> **Verification:** `tsc --noEmit` exits 0 after every commit; production `vite build` succeeds (192ms).

**Remaining items:**
- **HIGH (1 partial)**: 4 frontend god components left — `BottomDock` (689) / `BookmarksPanel` (886) / `SimContext` (670) / `MapView` (568). Each its own dedicated split.
- **MEDIUM (4)**: Modal primitive, SimContext into 3 contexts (overlaps with the SimContext god-component split), deeper backend i18n migration, residual frontend leaked strings.
- **LOW (1)**: `pickFields` / parser duplication (defer until Zod adoption).

**Score after post-v0.14.5 batch**: **24 of 25 HIGH (96%)** + **21 of ~25 MEDIUM (~84%)** + **9 of 10 LOW (90%)** + 2-of-6 sub-credit on the god-component HIGH item (DevicesPopover + useDevice) = **56 of ~60 review items resolved (~93%)**.

---

> **Post-v0.14.5 round 2 (commits on `main`, unreleased):** 10 commits across 3 worktree agents (J pre-kill + I' + J'). Pure structural refactor — no behavior, wire-format, or public-API changes.
> - **`BottomDock.tsx` split (1 + 6 commits, agents J & J'):** 689 → **103 LOC** — largest single shrinkage in the program. Seven new files in `frontend/src/components/shell/dock/`. Agent J extracted `Eyebrow` (41 LOC) before being killed mid-work; agent J' continued from the 648-LOC baseline and shipped six more: `DockRouteCard` (130), `RadiusRow` (61), `JoyPreview` (65), `SpeedToggle` (76), `ActionGroup` (125), `buildDockContext` (116). Subcomponents pull from contexts directly.
> - **`BookmarksPanel.tsx` split (3 commits, agent I'):** 895 → **499 LOC** (~100 over the 400 stretch target — agent flagged `BookmarksList` as natural follow-up split that would drop to ~380). Three new files in `frontend/src/components/library/`: `BookmarkRow` (308), `BookmarksToolbar` (272), `BookmarksFooter` (88). Note: prior agent I was killed mid-work with uncommitted state; all work was discarded and re-attempted fresh on a clean tree.
>
> **Verification:** `tsc --noEmit` clean after every commit; production `vite build` succeeds.

**Remaining items:**
- **HIGH (1 partial)**: 2 frontend god components left — `SimContext` (670) and `MapView` (568). SimContext overlaps with the MEDIUM "split into 3 contexts" item; should be a combined refactor.
- **MEDIUM (4)**: Modal primitive, SimContext into 3 contexts (combined with HIGH split above), deeper backend i18n migration, residual frontend leaked strings.
- **LOW (1)**: `pickFields` / parser duplication (defer until Zod adoption).

**Score after post-v0.14.5 round 2**: **24 of 25 HIGH (96%)** + **21 of ~25 MEDIUM (~84%)** + **9 of 10 LOW (90%)** + 4-of-6 sub-credit on the god-component HIGH item (DevicesPopover + useDevice + BookmarksPanel + BottomDock) = **58 of ~60 review items resolved (~97%)**.

---

## HIGH Priority

### Architecture / God modules

- **[DONE — final form] [HIGH] Architecture — `useSimulation.ts` is a 1126-line god hook**
  - File: `frontend/src/hooks/useSimulation.ts:1-1126`
  - Bundles seven concerns: WS dispatch, per-device runtimes, group fan-out, single-device actions, pause persistence, straight-line toggle, error translator. Returns 50+ values; consumers re-render on every WS tick.
  - Fix: split into `useSimWsDispatcher`, `useSimRuntimes`, `useSimGroupFanout`, `useSimSingle`, `usePauseSettings`, `useStraightLineToggle`, `useSimErrorTranslator`. `useSimulation` becomes a thin aggregator.
  - **v0.14.1**: extracted `useSimWsDispatcher` + `useSimRuntimes` + `usePauseSettings` + `useStraightLineToggle` to `hooks/sim/`. File now 656 lines (down from 1134) — well below the 800-line cap.
  - **Status closed**: `useSimGroupFanout` / `useSimSingle` deferred indefinitely — they would require funneling 30+ setters through a bundle pattern, which shuffles complexity rather than reducing it. The genuinely different next step is splitting SimContext into focused state/handlers/derived contexts (separate item under MEDIUM `value` memoization). The 656-line / 4-of-7-sub-hook form is the accepted final shape for this item.

- **[PARTIAL — DevicesPopover + useDevice + BookmarksPanel + BottomDock DONE] [HIGH] Architecture — `BottomDock.tsx` (689), `BookmarksPanel.tsx` (886), `DevicesPopover.tsx` (735), `SimContext.tsx` (670), `MapView.tsx` (568), `useDevice.ts` (556) all approach or exceed the 800-line cap**
  - Files listed above
  - Each hosts 3+ subviews / multi-step state machines. Large reach for any single edit; high regression surface.
  - Fix: extract subview components (`DeviceListView`, `DeviceManageView`, `DeviceAddView` for the popover; `BookmarkRow`, `BookmarksToolbar`, `BookmarkFooter` for the panel) into per-file modules.
  - **DONE (agent G, v0.14.5)**: `DevicesPopover.tsx` 744 → **132** LOC. Three new subview files at `frontend/src/components/device/`: `DeviceListView.tsx` (174), `DeviceManageView.tsx` (242), `DeviceAddView.tsx` (203), plus shared `deviceRowParts.tsx` (103) for DRY row primitives. Subviews call `useDeviceContext()` / `useToastContext()` / `useT()` directly rather than receiving god-bag props. Public `<DevicesPopover>` API unchanged. `tsc --noEmit` + `vite build` green.
  - **DONE (agent H, post-v0.14.5)**: `useDevice.ts` 560 → **252** LOC. Three new files in `frontend/src/hooks/device/`: `parsers.ts` (117 — pure type guards + payload interfaces + `deviceListEqual`); `useDeviceWs.ts` (148 — WS subscriber via setters-bundle ref pattern, matches `useSimWsDispatcher` precedent); `useWifiTunnel.ts` (149 — `wifiScanning` + `wifiDevices` + `tunnelStatus` + 5 callbacks; bonus `upsertDevice` helper deduplicates the copy-pasted replace-or-append pattern). Single `useDevice()` callsite (`DeviceContext.tsx:15`) untouched; type re-exports preserve all external imports.
  - **DONE (agent I', post-v0.14.5)**: `BookmarksPanel.tsx` 895 → **499** LOC (~100 over the 400 stretch target — agent flagged `BookmarksList` as natural future split). Three new files in `frontend/src/components/library/`: `BookmarkRow.tsx` (308 — per-row presentation), `BookmarksToolbar.tsx` (272 — search + filters + sort + selection bar), `BookmarksFooter.tsx` (88 — bulk actions + add). Public `BookmarksPanel` API (`onBookmarkClick`, `currentPosition`) unchanged; `LibraryDrawer.tsx` consumes identically. Note: prior agent I was killed mid-work with uncommitted state; all work was discarded and re-attempted fresh.
  - **DONE (agent J + J', post-v0.14.5)**: `BottomDock.tsx` 689 → **103** LOC. Largest single shrinkage of the program. Seven new files in `frontend/src/components/shell/dock/`: `Eyebrow.tsx` (41 — title/subtitle header; agent J pre-kill commit), then agent J' added `DockRouteCard.tsx` (130 — origin/destination card for Teleport+Navigate; renamed inner `DockRoutePoint` to avoid clashing with unrelated `RouteCard.tsx`), `RadiusRow.tsx` (61 — random-walk radius preset chips), `JoyPreview.tsx` (65 — decorative joystick pad + WASD hints), `SpeedToggle.tsx` (76 — Walk/Run/Drive preset rail), `ActionGroup.tsx` (125 — Start/Stop/Pause/Resume/Move cluster), `buildDockContext.ts` (116 — pure derivation of mode-specific title/subtitle/chainPoints + distance helpers). All subcomponents pull from `useSimContext` / `useBookmarkContext` / `useDeviceContext` directly. `BottomDock` zero-prop default export unchanged.
  - **Remaining**: `SimContext` (670) / `MapView` (568). Each is its own dedicated split — and SimContext overlaps with the MEDIUM "split into 3 contexts" item, so tackle them as one combined refactor.

- **[DONE] [HIGH] Architecture — `backend/api/wifi_tunnel.py` 673 lines with 165-line `wifi_repair` and 69-line `wifi_tunnel_stop` functions**
  - File: `backend/api/wifi_tunnel.py:138-303` (`wifi_repair`), `562-630` (`wifi_tunnel_stop`)
  - `wifi_tunnel_stop` reaches 8 levels of nested `try/except`. `wifi_repair` mixes USB selection, lockdown autopair, RemotePairing handshake, teardown.
  - Fix: extract `_select_usb_device`, `_perform_remote_pair_handshake`, `_close_remote_pair_resources`; replace nested catches with a state machine.
  - **DONE (helpers, agent B v0.14.4)**: `_select_usb_device` + `_perform_remote_pair_handshake` (with bonus `_purge_stale_remote_pair_record` companion) + `_close_remote_pair_resources` extracted; `wifi_repair` body shrank 165→~60 LOC and is now a linear sequencer (USB autopair → iOS gate → handshake in try/finally → teardown).
  - **DONE (state machine, agent E v0.14.5)**: `wifi_tunnel_stop` body **74 → 32 LOC** (-57%). Replaced 8-level nested try/except with ordered `_TeardownStep` dataclass + `_run_teardown_steps` helper (Phase 1 under lock: `cancel_watchdog` + `tunnel_stop`; Phase 2 outside lock: `usb_fallback` which itself uses the same helper for its 3-step rollback). Each step's failure logged at `logger.debug(..., exc_info=True)`; response shape (`{"status": "stopped"|"not_running"}`) byte-identical to original. Follow-up noted: `_cleanup_wifi_connections()` is the next candidate for the same helper (out of scope here).

- **[DONE] [HIGH] Architecture — Multiple 200+ line single-responsibility-violating loops**
  - `backend/core/movement_loop.py:42-291` `move_along_route` (~250 lines)
  - `backend/core/multi_stop.py:23-237` `MultiStopNavigator.start` (~215 lines)
  - `backend/core/random_walk.py:25-246` `RandomWalkHandler.start` (~222 lines)
  - Each contains hot-swap re-interp + per-leg execution + emit logic in one function with deep nesting.
  - Fix: extract `_run_iteration`, `_handle_pending_speed`, `_emit_position_update`, `_run_leg`, `_pause_at_stop`.
  - **Fixed (agent A, v0.14.4)**: `move_along_route` body 250→178 (`_push_position_with_retry`, `_emit_position_update`, `_check_waypoint_progress`, `_replan_for_speed_swap`); `MultiStopNavigator.start` body 215→144 (`_emit_full_route_preview`, `_navigate_to_first_waypoint`, `_run_leg`, `_pause_at_stop`, plus pure `_resolve_pause_seconds`); `RandomWalkHandler.start` body 222→137 (`_run_leg` returning `_LEG_*` sentinels confines the 5-branch try/except, `_pick_speed_profile`, `_handle_connection_error`, `_pause_after_arrival`). 7 magic numbers promoted to module constants. Public signatures unchanged. Cross-cutting follow-ups noted (engine waypoint-tracker abstraction, shared `pick_speed_profile` helper) — left as judgment calls for a future pass.

### Bugs (correctness)

- **[DONE] [HIGH] Stale ref read — scan result count is read before React commits**
  - File: `frontend/src/components/device/DevicesPopover.tsx:66`
  - `setScanResult(devicesRef.current.length)` runs in `finally` after the awaited scan, but `devicesRef.current` is updated by an effect that hasn't run yet → stale count.
  - Fix: have `device.scan()` return the list (it already does at `useDevice.ts:324`) and use the return value: `const list = await device.scan(); setScanResult(list.length)`.
  - **Fixed**: scan-result count now reads the awaited list. Bonus cleanup: dropped the now-dead `devicesRef` (was created via `useRef` and updated every render but never read elsewhere).

- **[DONE] [HIGH] Effect re-runs on identity change — `view` resets every parent render**
  - File: `frontend/src/components/device/DevicesPopover.tsx:48`
  - `useEffect(() => { if (anchor) setView('list') }, [anchor])` — `anchor: DOMRect` is a fresh object identity each open or window resize.
  - Fix: depend on the boolean: `useEffect(() => { if (anchor) setView('list') }, [!!anchor])`.
  - **Fixed**: dep widened to open/closed boolean.

- **[DONE] [HIGH] Order-losing setDevices**
  - Files: `frontend/src/hooks/useDevice.ts:443` (and same pattern at `:487`)
  - `setDevices(prev => [...prev.filter(d => d.udid !== info.udid), info])` always appends — known devices jump to the end whenever they re-arrive via WS.
  - Fix: `findIndex` then in-place replace; append only when not found.
  - **Fixed**: both sites use `findIndex` + immutable in-place replace; only append when device is new.

- **[DONE v0.14.1] [HIGH] Optimistic state without rollback**
  - File: `frontend/src/hooks/useSimulation.ts:809-853` (`pause`/`resume`/`joystickStart`/`joystickStop`); same shape in `navigate`/`startLoop`/`multiStop`/`randomWalk` (lines 730-805).
  - `setStatus` runs before `await api.*()`; failed call leaves UI inconsistent with backend.
  - Fix: only update state after successful await, or revert in `catch`.
  - **v0.14.1**: `navigate` / `startLoop` / `multiStop` / `randomWalk` / `joystickStart` capture pre-call mode via `modeRef.current` and revert on rejection; `pause`/`resume`/`joystickStop` were already post-await (no fix needed).

- **[DONE] [HIGH] Click handler installed before menu paints**
  - File: `frontend/src/components/MapContextMenu.tsx:75`
  - `document.addEventListener('click', handler)` registered synchronously; the right-click that opened the menu can immediately bubble to `document` and close it on browsers that synthesize a `click` after `contextmenu`.
  - Fix: register inside `setTimeout(..., 0)` or use `mousedown` + ref-bounds check (see `DevicesPopover` for the pattern).
  - **Fixed**: outside-click listener attaches inside `setTimeout(..., 0)`; cleanup clears the timeout if the effect tears down early.

- **[DONE] [HIGH] Async fetch with no abort/unmount guard**
  - File: `frontend/src/components/MapContextMenu.tsx:103`
  - `await reverseGeocode(lat, lng)` — closing the menu doesn't cancel the request; `setWhatsHere` may run on unmounted tree.
  - Fix: AbortController + `if (cancelled) return` guard.
  - **Fixed**: token-ref pattern (since `reverseGeocode` doesn't accept `AbortSignal`). Token bumps on close AND on every new `handleWhatsHere` call, so re-clicking cancels the prior in-flight request too.

- **[DONE] [HIGH] `wifi_repair` / `wifi_tunnel_stop` race**
  - File: `backend/api/wifi_tunnel.py:458-504` (`_tunnel_watchdog`)
  - After 5s sleep, the watchdog re-acquires `_tunnel.lock` and checks `_tunnel.task is task`. If `wifi_tunnel_stop()` has run and a fresh `wifi_tunnel_start()` is mid-flight, `_tunnel.task` could be transiently `None` and the watchdog will tear down healthy resources.
  - Fix: track tunnel generation (monotonic counter) and bail when generation changed.
  - **Fixed**: `TunnelRunner.generation: int = 0` bumps on successful `start()`. Watchdog captures `gen` at spawn; both early-bail (after `await task`) and post-sleep critical section gate on `_tunnel.generation == gen`. Logs mismatch and returns without teardown.

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

- **[DONE] [HIGH] `setCooldownEnabled` rollback double-toggles in StrictMode**
  - File: `frontend/src/contexts/SimContext.tsx:301`
  - `api.setCooldownEnabled(enabled).catch(() => setCooldownEnabled((v) => !v))` — `(v) => !v` runs twice in dev StrictMode, double-toggling. Also user is never notified of the failure.
  - Fix: revert with the original boolean (`setCooldownEnabled(!enabled)`) and `showToast` on failure.
  - **Fixed**: rollback uses the explicit `setCooldownEnabled(!enabled)`; new `err.cooldown_toggle_failed` toast surfaces the failure.

### Security

- **[DONE] [HIGH] `window.open` without `noopener`/`noreferrer` (reverse-tabnabbing)**
  - File: `frontend/src/contexts/BookmarkContext.tsx:189`
  - In Electron the renderer is sandboxed; in browser dev mode the new tab gets `window.opener`.
  - Fix: `window.open(url, '_blank', 'noopener,noreferrer')`. (The pattern in `lib/fileIo.ts:45` uses `a.rel = 'noopener'` correctly — apply the same here.)
  - **Fixed**: `handleGpxExport` now passes `'noopener,noreferrer'` features arg.

- **[DONE] [HIGH] Unvalidated `dict` POST body**
  - File: `backend/api/bookmarks.py:240` (`import_bookmarks`), `backend/services/bookmarks.py:532-579` (`import_json`)
  - Endpoint accepts `data: dict` then round-trips through `bm.import_json(json.dumps(data))`. A malicious export can re-use IDs that collide with default place IDs (defended in part by `existing_bm_ids` check, but tags/places aren't equally guarded).
  - Fix: bind a Pydantic schema; regenerate IDs on import (the way `api/route.py:124` does for `import_all_saved_routes`).
  - **Fixed**: every imported place / tag / bookmark gets a fresh `uuid.uuid4()`; `place_id` and `tags` references remapped via `place_id_map` / `tag_id_map`. Closes the preset-shadow attack surface.
  - **Side effect**: re-importing the same export now produces duplicates (intentional — payload IDs can no longer be trusted). Content-hash dedup `(name, lat, lng)` is the right follow-up if users complain.

- **[DONE] [HIGH] Subnet scan is unrate-limited (~254 concurrent connects)**
  - File: `backend/api/wifi_tunnel.py:331-363` (`_tcp_probe`, `_scan_subnet_for_port`)
  - Fires 254 parallel TCP probes every scan. On corporate networks this looks like reconnaissance.
  - Fix: gate with `asyncio.Semaphore(32)`.
  - **Fixed**: `_scan_subnet_for_port` now wraps each probe in `async with sem` (`asyncio.Semaphore(32)`); worst-case latency capped at ~3.2 s.

- **[DONE — backend; UI follow-up pending] [HIGH] `forget_device` partial-success silently masked**
  - File: `backend/api/device.py:137-195`, `_pair_record_candidates` (`:121-133`)
  - On macOS without root, `path.unlink()` on `/var/db/lockdown/*.plist` raises and is logged at WARNING (`:179`) but the endpoint still returns `{"status": "forgotten", "udid": udid, "removed": removed}` — UI thinks the device was forgotten while the iPhone still trusts the host.
  - Fix: surface aggregate `{"removed": [...], "failed": [...]}` and include `"failed"` in the success response so the UI can prompt for sudo / show a warning.
  - **Fixed (backend)**: tracks `failed: list[{path, error}]` alongside `removed`; returns `status: "partial"` (200) when at least one record was unlinked, raises `forget_failed` (500) only when every candidate errored. Frontend `forgetDevice` return type widened with `failed?: { path: string; error: string }[]`.
  - **Pending (frontend)**: UI toast on `status === 'partial'` — type is ready; `useDevice.ts:417` discards the response today. Trivial follow-up.

### Error handling

- **[DONE] [HIGH] 37 silent `except: pass` blocks in backend**
  - Files (clusters): `backend/api/wifi_tunnel.py` (10×: `:108`, `:285`, `:295`, `:340`, `:469`, `:492`, `:524`, etc.), `backend/api/device.py:70`, `:117`, `:177`, `backend/main.py:616`, `backend/core/ddi_mount.py` (5×), `backend/core/wifi_tunnel.py:80`, `:103`, `:105`, others.
  - Many wrap WS broadcasts (acceptable best-effort) but several wrap real cleanup that hides bugs (e.g. teardown in `wifi_tunnel.py:273-295`).
  - Fix: change every `except Exception: pass` to at least `logger.debug(..., exc_info=True)`. Promote anything in non-best-effort paths to `logger.warning`.
  - **v0.14.2 (8 sites)**: `core/ddi_mount.py` ×6, `core/device_manager.py` ×2 — all `logger.debug(..., exc_info=True)`.
  - **v0.14.3 (12 sites)**: `api/wifi_tunnel.py` ×10 + `api/device.py` ×2 — wifi cluster fully covered.
  - **Skipped intentionally (10 sites)**: `wait_for(stop_event, timeout=tick)` `asyncio.TimeoutError` (the timeout IS the next-tick signal), shutdown drain `(asyncio.CancelledError, Exception)`, file-already-gone `unlink()` — correct Python idioms.

- **[DONE] [HIGH] `LegacyLocationService.clear` swallows DeviceLost**
  - File: `backend/services/location_service.py:252-258`
  - `clear()` catches the reconnect-retry failure and only logs; `set()` correctly raises `DeviceLostError`. Result: a `clear()` failure on a dead device never propagates and the engine thinks everything is fine.
  - Fix: raise `DeviceLostError` in both paths.
  - **Fixed**: retry-after-reconnect failure now `raise DeviceLostError(...) from retry_exc`, matching `set()`'s discipline. Existing `DeviceLostError` catchers in engine `_run_handler` / movement_loop / `api.location._handle_device_lost` propagate cleanly.

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

- **[DONE] [HIGH] Auth-token cache never invalidates on 401**
  - File: `frontend/src/services/api.ts:142-156`
  - `authTokenPromise` is cached for the page lifetime. Server-side token rotation (currently doesn't happen, but is a documented future risk) → indefinite 401 with no recovery.
  - Fix: on a 401 response, set `authTokenPromise = null` and retry once.
  - **Fixed**: new `authedFetch` wraps every call; on 401 invalidates `authTokenPromise` and retries exactly once. Second 401 propagates normally — no infinite loop. `importGpx()` rebuilds `FormData` per attempt (consumed bodies cannot replay).

- **[DONE] [HIGH] Export URLs bypass the token**
  - File: `frontend/src/services/api.ts:336` (`bookmarksExportUrl`), `:391` (`exportGpxUrl`), `:396` (`exportAllRoutesUrl`)
  - URL-only helpers fed into `<a href>` / `window.open` (`BookmarkContext.tsx:189`). With `X-GPS-Token` enforced, these requests get a 401 and the user gets a blank tab.
  - Fix: route through `request()` and trigger a Blob download client-side, or have the backend mint short-lived signed URLs.
  - **Fixed**: removed all 3 URL helpers. New `downloadAuthed(path, filename)` private helper does `authedFetch GET → res.blob() → hidden anchor click → URL.revokeObjectURL`. Public exports `downloadBookmarksExport`, `downloadGpx`, `downloadAllRoutes`. `BookmarkContext.handleGpxExport` / `handleBookmarkExport` / `handleRoutesExportAll` restructured from URL fields to async handlers; consumers (`LibraryDrawer`, `RoutesPanel`) updated. New `toast.export_failed` i18n key. Dead `lib/fileIo.downloadUrl` removed.

---

## MEDIUM Priority

### DRY violations / duplicated logic

- **[DONE] [MEDIUM] `_http_err` defined identically in three files**
  - `backend/api/wifi_tunnel.py:26`, `backend/api/device.py:19`, `backend/api/location.py:31`
  - Fix: hoist to `backend/api/_errors.py`.
  - **Fixed**: new `backend/api/_errors.py` exports `http_err`; 3 local copies removed.

- **[DONE] [MEDIUM] `DeviceLostError` cause-walking duplicated**
  - `backend/core/simulation_engine.py:236-242`, `backend/api/location.py:236-242`, `:265-269`, `:292-300`
  - Fix: extract `_unwrap_device_lost(exc) -> DeviceLostError | None`.
  - **Fixed**: `unwrap_device_lost` exported from `services/location_service.py` (renamed without leading underscore — it's a public cross-module helper); 4 inline `__cause__` walks replaced.

- **[DONE] [MEDIUM] `_IS_DEV` + `devLog` reimplemented per file**
  - `frontend/src/contexts/BookmarkContext.tsx:8`, `frontend/src/hooks/useDevice.ts:21`, `frontend/src/hooks/useBookmarks.ts:4` — three near-identical implementations.
  - Fix: single `frontend/src/lib/dev-log.ts`.
  - **Fixed**: new `lib/dev-log.ts` exports `devLog` (`console.error`) + `devWarn` (`console.warn` — preserves `useDevice`'s intentional `console.warn` semantic for recoverable failures). 3 local copies removed.

- **[DONE] [MEDIUM] Clipboard fallback duplicated**
  - `frontend/src/components/library/BookmarksPanel.tsx:210`, `frontend/src/components/MapContextMenu.tsx:252`
  - Fix: `frontend/src/lib/clipboard.ts`.
  - **Fixed**: new `lib/clipboard.ts` exports `copyToClipboard(text) → Promise<boolean>`; defensive outer try/catch around the textarea-fallback path (slightly stronger than either inline original).

- **[DONE v0.14.1] [MEDIUM] Two parallel translation tables**
  - `frontend/src/services/api.ts:84-107` (`ERROR_I18N`) vs `frontend/src/i18n/strings.ts`
  - Translators must keep both in sync; missing keys don't fail typecheck.
  - Fix: move every `ERROR_I18N` entry into `i18n/strings.ts` under an `err.*` namespace, pass `t` into `formatError`.
  - **v0.14.1**: `ERROR_I18N` removed; 7 missing keys added under `err.*`. `formatError` looks up `STRINGS['err.<code>']`.

- **[DONE] [MEDIUM] Default pause object hardcoded in three places**
  - `frontend/src/hooks/useSimulation.ts:387,394,396,406` (`{ enabled: true, min: 5, max: 20 }`), `frontend/src/services/api.ts:218-219`, plus `frontend/src/lib/constants.ts:35` (which already exports `DEFAULT_PAUSE` but is unused)
  - Fix: import `DEFAULT_PAUSE` from constants everywhere.
  - **Fixed**: `usePauseSettings.ts` now imports `DEFAULT_PAUSE` from `lib/constants` instead of redeclaring locally. (`useSimulation.ts` references already cleaned up by the earlier `usePauseSettings` extraction.)

- **[DONE v0.14.3] [MEDIUM] Per-handler fan-out branching repeated**
  - `frontend/src/contexts/SimContext.tsx:339, 356, 465, 480, 495, 505` — every handler does `if (udids.length >= 2) toast(t('multi.start')) ; … else single` with the same toast wrapping.
  - Fix: a `runWithFanout(action, single, multi)` helper.

- **[MEDIUM] Modal anatomy reimplemented in 4+ places**
  - `App.tsx:337-388`, `SettingsMenu.tsx:301-384`, `BookmarkEditDialog.tsx`, `AvatarPicker.tsx` each define their own overlay + Esc handling + focus trap.
  - Fix: one `<Modal title body actions />` primitive that uses existing `useModalDismiss` + `useFocusTrap`.

- **[DONE] [MEDIUM] `MODE_LABEL_KEYS` duplicated**
  - `frontend/src/components/shell/BottomDock.tsx:184` hardcodes a SimMode→label-key map; `frontend/src/hooks/useSimulation.ts:233` already exports `MODE_LABEL_KEYS`.
  - Fix: import the existing constant.
  - **Fixed**: BottomDock now imports `MODE_LABEL_KEYS` from `useSimulation`; local copy removed.

### Response format inconsistency

- **[DONE v0.14.1] [MEDIUM] No consistent envelope across the API surface**
  - Mix of `{"status": "ok|started|stopped|deleted|forgotten|connected|disconnected|opened|already_running|not_running|dismissed"}`, raw model objects, counter-only `{"moved": N, "deleted": N}`, and `{"detail": {"code","message"}}` for errors.
  - Examples: `backend/api/location.py:201, 250, 324, 338, 386`; `backend/api/bookmarks.py:114, 128, 135, 244`; `backend/api/route.py:83`; `backend/api/device.py:71, 98, 118, 195, 269`.
  - Fix: standardise on `{success, data, error, meta}` envelope (per `~/.claude/rules/common/patterns.md`).
  - **v0.14.1**: `{success, data, error, meta?}` envelope adopted via `EnvelopeJSONResponse` (default response class) + global `HTTPException` / `RequestValidationError` handlers. File-download endpoints bypass via raw `Response(bytes)`. Frontend `request<T>()` unwraps `body.data`.

### Hardcoded user-facing strings (i18n leakage)

- **[DONE v0.14.3] [MEDIUM] Backend Chinese error messages in 30+ places**
  - Heaviest: `backend/api/location.py:82, 114, 156, 199, 222, 243, 524`; `backend/api/device.py:54, 78-83, 225, 237, 250, 264`; `backend/api/wifi_tunnel.py:70, 94, 121-128, 132, 191, 538, 545, 654, 673`; `backend/api/system.py:61, 75`; `backend/core/device_manager.py:378-380, 561-563`.
  - The `code` field is in English (good). The `message` is Chinese-only — non-zh users see Chinese.
  - Fix: keep `code` as the source of truth; let the frontend i18n layer pick the message. Drop or English-ify the backend-side `message` fields.

- **[DONE v0.14.3] [MEDIUM] Frontend leaked strings**
  - `frontend/src/components/library/BookmarksPanel.tsx:51-53` (`'預設'`, `'Default'`, `'Uncategorized'`) — same magic at `PlaceManagerDialog.tsx:57`, `BookmarkEditDialog.tsx:268`.
  - `frontend/src/components/shell/SettingsMenu.tsx:212, 215` (`'中文'` / `'English'`).
  - Fix: a single `isDefaultPlace(name)` helper for the bookmark special-name; add `lang.zh_native` / `lang.en_native` to `i18n/strings.ts`.

### Magic numbers / hardcoded config

- **[DONE] [MEDIUM] No env-var override for backend external services**
  - `backend/config.py:18` (`OSRM_BASE_URL`), `:21` (`NOMINATIM_BASE_URL`)
  - Operators on restricted networks / self-hosted OSRM must fork the file.
  - Fix: `os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org")`.
  - **Fixed**: both URLs respect `$OSRM_BASE_URL` / `$NOMINATIM_BASE_URL` env vars.

- **[DONE] [MEDIUM] No env-var override for the frontend API host**
  - `frontend/src/lib/constants.ts:29` (`API_HOST = '127.0.0.1:8777'`)
  - Fix: `import.meta.env.VITE_API_HOST ?? '127.0.0.1:8777'`.
  - **Fixed**: `API_HOST` reads `import.meta.env.VITE_API_HOST` with fallback. `vite-env.d.ts` extended via declaration merge (Vite-recommended).

- **[DONE] [MEDIUM] Movement / random-walk thresholds are inline literals**
  - `backend/core/multi_stop.py:117` (`> 50` first-waypoint distance).
  - `backend/core/random_walk.py:82, 86, 152` (error budgets, backoff cap).
  - `backend/core/movement_loop.py:169` (`asyncio.sleep(0.5 * (attempt + 1))`).
  - `backend/core/simulation_engine.py:420` (`int(time.time() * 1000) & 0x7FFFFFFF`).
  - Fix: promote to module-level named constants (`_FIRST_WAYPOINT_REACH_THRESHOLD_M`, `_MAX_CONSECUTIVE_ERRORS`, `_RECONNECT_BACKOFF_BASE_S`, `_DEFAULT_RANDOM_WALK_SEED_MASK`).
  - **Fixed**: 5 module-level constants promoted with the requested names.

- **[DONE] [MEDIUM] Frontend visual constants inline**
  - `frontend/src/components/library/BookmarksPanel.tsx:145` (`1e-5` coord match), `:223` (`1200` flash ms), `:536` (`5` visible cap), `:478-480` (`2` stripe).
  - `frontend/src/components/MapView.tsx:323` (`> 500` auto-recenter), `:323` (`latScale = 111320`).
  - Fix: extract `BOOKMARK_MATCH_EPSILON`, `COPIED_FLASH_MS`, `PLACE_CHIPS_VISIBLE_CAP`, `AUTO_RECENTER_THRESHOLD_M`, `METERS_PER_DEGREE_LAT` (latter likely shared with `geo.ts`).
  - **Fixed**: all 6 named constants promoted; `METERS_PER_DEGREE_LAT` lives in `lib/geo.ts`. Stripe constant required moving from Tailwind arbitrary class to inline `style={{}}` to reference the JS const.

### Tight coupling / leaky abstractions

- **[DONE] [MEDIUM] `as any` casts: 12 sites, 10 in `MapView.tsx`**
  - File: `frontend/src/components/MapView.tsx` (lines `135, 140, 274, 294, 297, 298, 312, 339, 349, 350`); plus `useSimulation.ts` and `useDevice.ts` (1 each).
  - Most reach into Leaflet private API (`_controlCorners`); the rest cast public methods (`setLatLng`, `setIcon`) that are already typed.
  - Fix: define `type LeafletMapInternal = L.Map & { _controlCorners?: { topleft?: HTMLElement; topright?: HTMLElement } }`, cast once, drop the rest.
  - **Fixed**: actual count was 10 (audit confirmed `useSimulation` / `useDevice` had zero — the review tally was off). 2 Leaflet-private casts moved to a typed `LeafletMapInternal` alias. The other 8 were bandaids around `currentMarkerRef` being typed `L.CircleMarker` when the runtime creates `L.Marker` — fixing the ref type let `setLatLng` / `setIcon` / `setTooltipContent` / `remove` resolve from public Leaflet typings, casts deleted.

- **[MEDIUM] `value` memoization in SimContext gives almost nothing**
  - File: `frontend/src/contexts/SimContext.tsx:576-646`
  - Deps include `sim` and `joystick` whole objects — their identity changes on most state updates → all consumers re-render on every WS event.
  - Fix: deconstruct only the fields the value actually consumes, or split SimContext into focused contexts (state vs handlers vs derived).

- **[DONE v0.14.5] [MEDIUM] `__init__` of SimulationEngine sets ~25 attributes**
  - File: `backend/core/simulation_engine.py:150-209`
  - Fix: split into a `@dataclass` of "runtime tracking" fields and a separate state container.
  - **Fixed (agent F)**: `__init__` body **63 → 18 LOC**. Two private dataclasses introduced: `_RuntimeLocks` (3 fields: `_pause_event`, `_stop_event`, `_apply_speed_lock`; `__post_init__` presets `_pause_event` to preserve "set = running" invariant) and `_RuntimeState` (18 fields: state, current_position, snapshot, route/waypoint/lap/segment/speed tracking). A small `_spread(target, source)` helper bulk-`setattr`s every dataclass field onto `self`, so the public attribute access surface is byte-identical — zero caller migration needed across `movement_loop` / `multi_stop` / `random_walk` / `api/location`. Long-lived service handles + sub-handlers stay assigned directly. Future migration to `engine._state.foo` access is straightforward but deferred (would touch 6+ files).

- **[DONE] [MEDIUM] Two effects manage the same Leaflet layer**
  - File: `frontend/src/components/MapView.tsx:108` (reacts to layerKey) and `:119` (initial mount with `[]` deps + `eslint-disable` at `:264`).
  - Race: fast user clicks during initial mount can interleave.
  - Fix: collapse into one effect or guard the layerKey one to no-op until the init effect committed.
  - **Fixed**: collapsed into a single `[layerKey]`-deps effect. Bonus: the original `[]` init effect was reading `layerKey` without subscribing — any prop change between commit and the swap effect's first run was silently swallowed. Map + ResizeObserver teardown extracted to its own `[]` effect (deps captured via refs). `eslint-disable` comment fully removed.

### Other functional issues

- **[DONE] [MEDIUM] WS broadcast is sequential**
  - File: `backend/api/websocket.py:25-35`
  - One slow client blocks all others.
  - Fix: `asyncio.gather` with per-client `asyncio.wait_for(ws.send_text(...), 1.0)` and dead-list pruning.
  - **Fixed**: `_send_one(ws)` per-client coro with `asyncio.wait_for(..., _BROADCAST_PER_CLIENT_TIMEOUT_S=1.0)`; `asyncio.gather` fans out; dead clients pruned post-gather. Slow clients no longer block the rest.

- **[DONE] [MEDIUM] `_engine` orchestration function (76 lines, two retry loops, exception walking)**
  - File: `backend/api/location.py:41-116`
  - Fix: split into `_get_or_rebuild_engine`, `_resolve_target_udid`, `_force_reconnect`.
  - **Fixed**: split into the requested 3 helpers + a 19-line orchestrator (`_engine`).

- **[DONE] [MEDIUM] Saved routes module-level singleton with no isolation**
  - File: `backend/api/route.py:30, 49` (`_saved_routes`, `_saved_routes_lock`)
  - Fix: hide behind a `SavedRoutesStore` class so tests can construct a fresh instance.
  - **Fixed**: new `backend/services/saved_routes.py` exports `SavedRoutesStore` (`add`, `get`, `delete`, `rename`, `list`, `import_all`); `api/route.py` instantiates one at module level. Tests can now build their own.

- **[DONE] [MEDIUM] String-match exception classification**
  - File: `backend/api/wifi_tunnel.py:74-75, 162, 254, 257-263`
  - `_msg.lower()` matched against `"PairingDialogResponsePending"`, `"consent"`, `"not paired"`, `"pairingerror"`. Brittle across pymobiledevice3 versions.
  - Fix: match on exception classes from pymobiledevice3.
  - **Fixed**: actual count was 1 block (audit; review tally was over-stated). Replaced with `isinstance(exc, (PairingDialogResponsePendingError, NotPairedError, PairingError))`.

- **[DONE] [MEDIUM] No `Bookmark.tags` length cap or uniqueness**
  - File: `backend/models/schemas.py:208`
  - A POST with 10K tags is accepted.
  - Fix: `Field(max_items=64)` and dedupe on write.
  - **Fixed**: `Field(max_length=64)` (Pydantic v2 syntax). `BookmarkManager.create_bookmark` / `update_bookmark` dedupe via `list(dict.fromkeys(...))` after the known-tag-id filter — preserves order of first occurrence.

---

## LOW Priority

- **[DONE v0.14.3] [LOW] Inline mouseEnter/Leave style mutation**
  - `frontend/src/components/MapContextMenu.tsx:331-337`, `frontend/src/components/shell/BottomDock.tsx:584-585`, `frontend/src/components/library/BookmarksPanel.tsx` (multiple sites). Direct DOM writes when CSS `:hover` would do.
  - **Fixed**: MapContextMenu + BottomDock moved to CSS `:hover` via custom properties. BookmarksPanel had zero remaining sites at HEAD (already cleaned). MapContextMenu fix also corrected a clobbered hover colour — JS handlers were overriding the design's `:hover` rule.

- **[DONE v0.14.3] [LOW] Dead `void` retainers**
  - `frontend/src/components/shell/BottomDock.tsx:687-689` — `void Repeat; void Dices; void Plus` to silence unused-import lint. Either use them or remove.
  - **Fixed**: `Repeat` is actually used at line 165 — preserved. `Dices` and `Plus` were dead — both removed along with all 3 `void` retainers.

- **[DONE v0.14.3] [LOW] `_haversine_m = haversine_m` redundant alias**
  - `backend/services/route_service.py:30`.
  - **Fixed**: alias removed; single call site uses `haversine_m` directly.

- **[DONE v0.14.3] [LOW] Storage-key prefix inconsistency**
  - `frontend/src/lib/storage-keys.ts:15-16` — `gpsController.*` (camelCase) vs everything else `gpscontroller.*`. Comment explains the migration; add a one-shot rename and remove the camelCase entries.
  - **Fixed**: keys renamed to canonical `gpscontroller.avatar_selection` / `gpscontroller.avatar_custom`. New `migrateAvatarKeys()` helper called from `main.tsx` once at startup copies legacy values then deletes them; idempotent on subsequent boots.

- **[DONE v0.14.3] [LOW] `SettingsMenu` outside-click uses `mousedown`, not `pointerdown`**
  - `frontend/src/components/shell/SettingsMenu.tsx:84` — touch-based Electron windows may not close.
  - **Fixed**: `mousedown` → `pointerdown`. `MouseEvent`-typed handler still type-checks since `PointerEvent extends MouseEvent`.

- **[DONE v0.14.4] [LOW] Inline imports inside functions**
  - `backend/api/location.py:48-49, 66, 125, 153, 186, 280, 295, 522`; `backend/api/device.py:45, 60, 114, 189, 230, 255`. Pull to top of file for readability.
  - **Done**: `api/location.py` (agent A, v0.14.3).
  - **Done (agent C, v0.14.4)**: `api/device.py` +5 hoists (1 left inline: `AmfiService` — guarded by `try/except ImportError`, optional dep); `api/system.py` +1 (`ctypes`); `api/route.py` +3 (`json`, `Response` ×2 → 1).
  - **Skipped intentionally**: `api/websocket.py:_main` — the inline `import main as _main` breaks a circular: `main.py` imports `api.websocket.router` at module load, so hoisting would deadlock the import graph and leave `main.API_TOKEN` undefined at first reference.

- **[N/A — premise incorrect] [LOW] `safe_write_json` runs `json.dumps` outside the protected try**
  - `backend/services/json_safe.py:86-124` — a serialisation error short-circuits the cleanup path.
  - **Verified**: the `try:` opens at line 93 and `body = json.dumps(payload, ...)` sits inside it at line 98 (verified at HEAD~2 too — layout unchanged since `1c0b1fb` 2026-04-19). Serialisation errors ARE caught by the outer `except Exception`; at that point `tmp_path is None` so the cleanup block is a safe no-op. No bug to fix.

- **[DONE v0.14.3] [LOW] Export `currentLang()` ignores localStorage failures silently**
  - `frontend/src/services/api.ts:109-115` — Electron sandbox could disable storage; user gets nav-language fallback indefinitely with no log.
  - **Fixed**: module-level `warnedLocalStorage` flag fires `devWarn` once on the first throw; subsequent calls skip the warn.

- **[DONE v0.14.3] [LOW] Module side-effect: `DATA_DIR.mkdir()` at import time**
  - `backend/config.py:8` — awkward for tests.
  - **Fixed**: `DATA_DIR.mkdir()` removed from import path; new `ensure_data_dir()` helper called as the FIRST statement of `main.py` lifespan startup, before any file I/O. Tests no longer trigger a real `~/.gpscontroller/` creation just from importing `config`.

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
