const { contextBridge, ipcRenderer } = require('electron')

// Preload script runs with `sandbox: true` so the full `node:*` surface
// isn't available — keep this file to the minimum safe surface.
//
// Exposes two renderer-visible values:
//   - version:         the app version, forwarded via `additionalArguments`
//                      so the UI can read it synchronously (non-sensitive,
//                      argv exposure is fine).
//   - getSessionToken: async accessor for the session-scoped auth token
//                      held by the main process. Resolved over the
//                      `session:get-token` IPC channel so the value never
//                      lands on `process.argv` (visible to other same-user
//                      processes via `ps aux` / `/proc/<pid>/cmdline`).
//                      Used as the X-GPS-Token header for REST calls and
//                      the first frame of every WebSocket connection.
//
// The previous auto-updater bridge (`gpscontrollerUpdater`) was never
// wired to any `ipcMain` handler and no renderer code consumed it, so
// it was removed to shrink the IPC attack surface. When a real auto-
// updater is introduced, add a new handle here with matching
// `ipcMain.handle` in main.js.
function readArg(prefix) {
  const hit = (process.argv || []).find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

contextBridge.exposeInMainWorld('gpsController', {
  version: readArg('--gps-version='),
  getSessionToken: () => ipcRenderer.invoke('session:get-token'),
})
