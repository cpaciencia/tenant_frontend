import { join } from 'path'
import { BrowserWindow, screen, type Display } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IpcChannels } from '../../shared/ipc'
import type { CartState } from '../../shared/types'
import { pickExternalDisplay } from './displays'

const EMPTY_CART: CartState = { lines: [], totalCents: 0 }

/**
 * Manages a fullscreen window on the secondary monitor that mirrors the cart to
 * the customer. Opens/closes/repositions itself as displays are plugged in or
 * removed, and keeps the latest cart snapshot so a freshly opened window is
 * immediately up to date.
 */
export class CustomerDisplayManager {
  private window: BrowserWindow | null = null
  private latestState: CartState = EMPTY_CART
  /** Disabled by default: the display only opens once explicitly enabled. */
  private enabled = false

  /**
   * Start watching displays. Must be called after the app is ready. The window
   * stays closed unless `enabled` is true AND a secondary monitor is present.
   */
  init(enabled: boolean): void {
    this.enabled = enabled
    this.sync()
    screen.on('display-added', () => this.sync())
    screen.on('display-removed', () => this.sync())
  }

  /** Turn the customer display on or off live; opens/closes the window to match. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.sync()
  }

  /** Replace the mirrored cart and push it to the window if open. */
  update(state: CartState): void {
    this.latestState = state
    this.pushState()
  }

  private sync(): void {
    // When disabled, resolve no external display so any open window is closed
    // and none is ever opened.
    const external = this.enabled
      ? pickExternalDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id)
      : null
    if (external && !this.window) {
      this.open(external)
    } else if (!external && this.window) {
      this.close()
    } else if (external && this.window) {
      this.window.setBounds(external.bounds)
    }
  }

  private open(display: Display): void {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      fullscreen: true,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    win.on('closed', () => {
      if (this.window === win) this.window = null
    })
    // Resend the current cart once the renderer has attached its listener.
    win.webContents.on('did-finish-load', () => this.pushState())

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#customer`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'customer' })
    }
    this.window = win
  }

  private pushState(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannels.customerDisplayState, this.latestState)
    }
  }

  private close(): void {
    this.window?.close()
    this.window = null
  }
}
