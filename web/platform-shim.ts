import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/types'

/**
 * In Electron the renderer reaches the Main process through `window.api` (the
 * preload context bridge). The browser has no preload, so components that touch
 * per-terminal local config (e.g. ConfiguracionSection) would crash. This shim
 * provides a no-op, in-memory `window.api` so the SHARED components mount
 * unchanged in the browser.
 *
 * Per-terminal settings are local to a physical POS and are NOT something the web
 * backoffice manages — hence the in-memory stub. Genuinely shared management data
 * (products, users, tickets, stock) will go through an HTTP client to the cloud
 * backend, not through this shim.
 */
export function installWebPlatformShim(): void {
  if (typeof window === 'undefined' || (window as unknown as { api?: unknown }).api) return

  let settings: AppSettings = { ...DEFAULT_SETTINGS }

  ;(window as unknown as { api: unknown }).api = {
    settings: {
      get: async (): Promise<AppSettings> => ({ ...settings }),
      update: async (patch: Partial<AppSettings>): Promise<AppSettings> => {
        settings = { ...settings, ...patch }
        return { ...settings }
      }
    }
  }
}