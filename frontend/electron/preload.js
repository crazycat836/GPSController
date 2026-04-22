const { contextBridge } = require('electron')

// Preload script runs with `sandbox: true` so the full `node:*` surface
// isn't available — keep this file to the minimum safe surface.
//
// Exposes two renderer-visible values:
//   - version: the app version, so the UI can show it without hitting
//              the backend
//   - token:   the session-scoped auth token, read by the main process
//              from ~/.gpscontroller/token and forwarded here via
//              `additionalArguments`. Used as the X-GPS-Token header
//              for REST calls and the first frame of every WebSocket
//              connection.
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
  token: readArg('--gps-token='),
})
