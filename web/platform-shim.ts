import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/types'
import { IpcChannels } from '../src/shared/ipc'

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
    // The shim is built with the page, so it is never stale.
    ipcChannels: Object.values(IpcChannels),
    settings: {
      get: async (): Promise<AppSettings> => ({ ...settings }),
      update: async (patch: Partial<AppSettings>): Promise<AppSettings> => {
        settings = { ...settings, ...patch }
        return { ...settings }
      }
    },
    // The local outbound sync queue is terminal-local; the web target has none.
    sync: {
      status: async (): Promise<{ pending: number; total: number }> => ({ pending: 0, total: 0 }),
      resyncAll: async (): Promise<{ requeued: number; pending: number }> => ({
        requeued: 0,
        pending: 0
      })
    },
    // No local mirror on the web target; the catalog is read straight from the backend.
    catalog: {
      refresh: async (): Promise<{
        accountingGroups: number | null
        categories: number | null
        products: number | null
        users: number | null
      }> => ({ accountingGroups: 0, categories: 0, products: 0, users: 0 })
    },
    // Cash sessions are terminal-local (the till); the web target has none.
    cashSession: {
      open: async (): Promise<never> => {
        throw new Error('Las cajas solo existen en el terminal de venta')
      },
      current: async (): Promise<null> => null,
      lastClosingFloat: async (): Promise<null> => null,
      accept: async (): Promise<never> => {
        throw new Error('Las cajas solo existen en el terminal de venta')
      },
      arqueo: async (): Promise<never> => {
        throw new Error('Las cajas solo existen en el terminal de venta')
      },
      close: async (): Promise<never> => {
        throw new Error('Las cajas solo existen en el terminal de venta')
      },
      history: async (): Promise<never[]> => []
    },
    // Pending items and the audit log live on the till; the web has neither.
    pendingItems: {
      list: async (): Promise<never[]> => [],
      complete: async (): Promise<never> => {
        throw new Error('Los pendientes se gestionan en el terminal de venta')
      },
      dismiss: async (): Promise<never> => {
        throw new Error('Los pendientes se gestionan en el terminal de venta')
      }
    },
    audit: { record: async (): Promise<void> => {} },
    // Cash movements belong to the till's caja.
    cashMovements: {
      record: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      },
      current: async () => ({
        cashInCents: 0,
        cashOutCents: 0,
        supplierPaymentsCents: 0,
        otherPaymentsCents: 0,
        cashInPendingCents: 0,
        invoicesPending: 0,
        list: []
      }),
      suppliers: async (): Promise<never[]> => [],
      markInvoiceUploaded: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      }
    },
    // "A cuenta" clients at the till (the web backoffice uses /api/clients).
    clients: {
      list: async (): Promise<never[]> => [],
      create: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      },
      account: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      },
      refresh: async (): Promise<never[]> => [],
      settle: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      }
    },
    // Parked tickets live on the till.
    parked: {
      list: async (): Promise<never[]> => [],
      park: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      },
      resume: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      },
      discard: async (): Promise<never> => {
        throw new Error('Solo en el terminal de venta')
      }
    },
    // No filesystem in the browser: print the document; the browser's print
    // dialog offers "Save as PDF".
    print: {
      savePdf: (html: string): Promise<{ saved: boolean }> => printHtml(html)
    }
  }
}

function printHtml(html: string): Promise<{ saved: boolean }> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    frame.srcdoc = html
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 1000)
      resolve({ saved: true })
    }
    document.body.appendChild(frame)
  })
}
