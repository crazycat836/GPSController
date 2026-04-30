const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { spawn } = require('child_process')

// Single source of truth for the app version — same file Electron already
// consumes for `app.getVersion()` / auto-updater metadata.
const APP_VERSION = require('../package.json').version

// Session token written by the backend on startup. See backend/config.py
// TOKEN_FILE and backend/main.py lifespan. We read it lazily (after the
// backend is up) so the value we inject into the renderer is the fresh
// one for this run, not a stale file from a previous crash.
const TOKEN_FILE = path.join(os.homedir(), '.gpscontroller', 'token')

function readSessionToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

// Deliver the session token to the renderer via a one-time IPC handshake
// instead of `additionalArguments`. argv is visible to other same-user
// processes (`ps aux`, `/proc/<pid>/cmdline`) on macOS/Linux, so a
// session-scoped auth token has no business being on the command line.
//
// The handler is registered at module load — well before any
// BrowserWindow is created — so the channel is always wired up by the
// time the renderer's preload invokes it.
let cachedSessionToken = ''
ipcMain.handle('session:get-token', () => cachedSessionToken)

// Strip the default "File Edit View Window Help" menubar — GPSController has its
// own in-window controls and the native menu only adds noise on Windows.
Menu.setApplicationMenu(null)

let mainWindow
let backendProc = null

function resolveBackendExe() {
  // In a packaged build, extraResources places files under
  // process.resourcesPath (e.g. .../resources/backend/<binary>). PyInstaller
  // names the binary `.exe` on Windows and leaves it unsuffixed on macOS,
  // so we branch on process.platform. In dev we don't spawn; the developer
  // runs `python start.py` (or similar) manually.
  if (!app.isPackaged) return null
  const binName = process.platform === 'win32'
    ? 'gpscontroller-backend.exe'
    : 'gpscontroller-backend'
  return path.join(process.resourcesPath, 'backend', binName)
}

function startBackend() {
  const exe = resolveBackendExe()
  if (!exe) return
  console.log('[electron] spawning backend:', exe)
  const spawnOpts = {
    cwd: path.dirname(exe),
    stdio: ['ignore', 'pipe', 'pipe'],
  }
  if (process.platform === 'win32') {
    spawnOpts.windowsHide = true
  }
  backendProc = spawn(exe, [], spawnOpts)
  backendProc.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`))
  backendProc.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`))
  backendProc.on('exit', (code) => {
    console.log('[electron] backend exited with code', code)
    backendProc = null
  })
}

function stopBackend() {
  if (!backendProc) return
  try { backendProc.kill() } catch {}
  backendProc = null
}

async function createWindow() {
  // OSM tile policy (https://operations.osmfoundation.org/policies/tiles/)
  // requires an identifying User-Agent; Electron's default Chrome UA is
  // blocked with HTTP 418. Rewrite the UA on requests to the OSM tile
  // endpoints so we can use the 'Standard' (Mapnik) style for free.
  try {
    const { session } = require('electron')
    const OSM_HOSTS = [
      'tile.openstreetmap.org',
      'a.tile.openstreetmap.org',
      'b.tile.openstreetmap.org',
      'c.tile.openstreetmap.org',
      'tile.openstreetmap.fr',
      'a.tile.openstreetmap.fr',
      'b.tile.openstreetmap.fr',
      'c.tile.openstreetmap.fr',
    ]
    session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
      try {
        const u = new URL(details.url)
        if (OSM_HOSTS.includes(u.hostname)) {
          details.requestHeaders['User-Agent'] =
            `GPSController/${APP_VERSION} (+https://github.com/keezxc1223/gpscontroller)`
          details.requestHeaders['Referer'] = 'https://github.com/keezxc1223/gpscontroller'
        }
      } catch {}
      cb({ requestHeaders: details.requestHeaders })
    })
  } catch (e) { console.error('[electron] UA hook failed:', e) }

  // Backend writes the token file before accepting any HTTP request. By
  // the time the renderer issues its first request the file is on disk;
  // in dev mode it's empty (GPSCONTROLLER_DEV_NOAUTH=1).
  cachedSessionToken = readSessionToken()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'GPSController',
    // Match the app's dark theme so the initial frame isn't white while
    // the renderer attaches — previously caused a jarring white flash.
    backgroundColor: '#0f1117',
    show: false,
    webPreferences: {
      // Chromium's OS-level sandbox: required for a defence-in-depth
      // posture even with contextIsolation on. Forces the preload to
      // run in the isolated world without `node:*` access.
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Only the version is forwarded via argv — it's non-sensitive and
      // lets preload expose `version` synchronously without an IPC round
      // trip. The session token is delivered via the
      // `session:get-token` IPC handshake instead (see ipcMain.handle
      // above) to keep it out of `process.argv`.
      additionalArguments: [
        `--gps-version=${APP_VERSION}`,
      ],
    },
  })
  // Show the window once the first frame is painted. Combined with
  // backgroundColor above, this eliminates the blank/white boot state.
  mainWindow.once('ready-to-show', () => { mainWindow.show() })

  // Open target="_blank" / external links in the user's default browser.
  // Only `https:` URLs are forwarded to the OS; `http:`, `file:`,
  // `javascript:`, and any custom scheme are blocked. Parsing failure is
  // also treated as deny so a malformed URL can't slip through.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:') {
        shell.openExternal(url)
      }
    } catch {
      // Malformed URL — ignore.
    }
    return { action: 'deny' }
  })

  const isDev = process.argv.includes('--dev') || !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    // Spawn the backend in parallel and load the UI immediately. The
    // renderer already has fetch-with-retry so it rides out the backend
    // startup race — no need to block loadFile on a readiness probe and
    // stare at a blank window for seconds.
    startBackend()
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', stopBackend)
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
