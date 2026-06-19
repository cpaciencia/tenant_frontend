import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDatabase, closeDatabase } from './db'
import { seedDevProducts } from './db/seed'
import { registerEnrollmentHandlers, registerDbHandlers } from './ipc'
import { CustomerDisplayManager } from './windows/customerDisplay'
import { getSettings } from './repositories/settings'
import { createSyncClient } from './sync/client'
import { SyncWorker } from './sync/worker'
import { pullUsers } from './sync/userPull'
import { pullCategories } from './sync/categoryPull'
import { pullProducts } from './sync/productPull'
import { pullAccountingGroups } from './sync/accountingGroupPull'
import { createEnrollmentClient } from './enrollment/client'
import { createSafeStorageCredentialStore } from './enrollment/safeStorageStore'
import { EnrollmentService } from './enrollment/service'
import { createFileBootstrapConfig } from './bootstrap/config'
import { installCsp } from './security/csp'

let syncWorker: SyncWorker | null = null
let runtimeStarted = false

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    title: 'Camping Parque Tropical - POS',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Customer-facing display starts disabled; once the (encrypted) DB is open we
  // apply the persisted preference.
  const customerDisplay = new CustomerDisplayManager()
  customerDisplay.init(false)

  // Pre-enrolment config + sealed credentials, both readable WITHOUT the DB.
  const userData = app.getPath('userData')
  const bootstrap = createFileBootstrapConfig(join(userData, 'bootstrap.json'))
  const credentialStore = createSafeStorageCredentialStore(join(userData, 'terminal.enc'))

  // Serve the CSP from Main so connect-src can whitelist this terminal's backend
  // origin (read lazily so it tracks re-enrolment). Must run before the window loads.
  installCsp(() => bootstrap.getSyncApiUrl())

  // Bring up the DB-backed runtime: open the encrypted DB with the enrolment key,
  // migrate, wire DB handlers, customer display and background sync. Runs once —
  // either now (already enrolled) or right after enrolment completes.
  async function startRuntime(dbKey: string): Promise<void> {
    if (runtimeStarted) return
    runtimeStarted = true
    const db = await initDatabase(dbKey)
    if (is.dev) seedDevProducts(db)
    registerDbHandlers(db, customerDisplay, () => bootstrap.getSyncApiUrl())
    customerDisplay.setEnabled(getSettings(db).customerDisplayEnabled)
    syncWorker = new SyncWorker(db, createSyncClient(() => bootstrap.getSyncApiUrl()))
    syncWorker.start()
    // Refresh the local mirrors so the POS works offline with fresh data:
    // users (login hashes+permissions), categories and products (the catalog the
    // till sells from). All best-effort — a network failure leaves the existing
    // mirror in place.
    const baseUrl = bootstrap.getSyncApiUrl()
    pullUsers(db, baseUrl).catch(() => {
      /* offline or backend down — offline login still works from the mirror */
    })
    pullAccountingGroups(db, baseUrl).catch(() => {
      /* offline — the Z-report labels buckets from whatever the mirror holds */
    })
    pullCategories(db, baseUrl).catch(() => {
      /* offline — the grid uses whatever categories the mirror already holds */
    })
    pullProducts(db, baseUrl).catch(() => {
      /* offline — the grid uses whatever products the mirror already holds */
    })
  }

  // Terminal enrolment: no DB needed. On success, open the runtime; if a runtime
  // is already up (re-enrolment), relaunch so the new key takes effect cleanly.
  const enrollment = new EnrollmentService(
    bootstrap,
    createEnrollmentClient(),
    credentialStore,
    async (credentials) => {
      if (runtimeStarted) {
        app.relaunch()
        app.exit(0)
        return
      }
      await startRuntime(credentials.dbKey)
    }
  )
  registerEnrollmentHandlers(enrollment)

  // If this terminal is already enrolled, unlock the DB before the window loads.
  const existing = credentialStore.load()
  if (existing) {
    await startRuntime(existing.dbKey)
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Stop the sync worker and close the database cleanly (WAL checkpoint) on exit.
app.on('will-quit', () => {
  syncWorker?.stop()
  closeDatabase()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
