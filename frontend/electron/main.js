const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

let mainWindow
let backendProc = null

function resolveBackendExe() {
  // In a packaged build, extraResources places files under process.resourcesPath
  // (e.g.  .../resources/backend/locwarp-backend.exe).  In dev, we don't spawn;
  // the developer runs `python main.py` manually.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'locwarp-backend.exe')
  }
  return null
}

function startBackend() {
  const exe = resolveBackendExe()
  if (!exe) return
  console.log('[electron] spawning backend:', exe)
  backendProc = spawn(exe, [], {
    cwd: path.dirname(exe),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
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

function waitForBackend(timeoutMs = 30000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get('http://127.0.0.1:8777/docs', (res) => {
        res.destroy()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) return reject(new Error('backend timeout'))
        setTimeout(tick, 500)
      })
    }
    tick()
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'LocWarp',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Open target="_blank" / external links in the user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })

  const isDev = process.argv.includes('--dev') || !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    startBackend()
    try {
      await waitForBackend()
    } catch (err) {
      console.error('[electron] backend did not come up:', err)
    }
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
