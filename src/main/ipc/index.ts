import { ipcMain } from 'electron'
import type { DB } from '../db/connection'
import { IpcChannels } from '../../shared/ipc'
import type {
  AppSettings,
  CartItemInput,
  CartState,
  CreateSaleRequest,
  EnrollRequest
} from '../../shared/types'
import { listProducts, getProductByBarcode } from '../repositories/products'
import { listCategories } from '../repositories/categories'
import { getSettings, updateSettings } from '../repositories/settings'
import { createSale } from '../services/sales'
import { previewZReport, closeZReport, listZClosures } from '../services/zReport'
import { AuthService } from '../services/auth'
import type { CustomerDisplayManager } from '../windows/customerDisplay'
import type { EnrollmentService } from '../enrollment/service'

/** Anything arriving over IPC is untrusted input — validate before it reaches the DB. */
function assertCreateSaleRequest(value: unknown): asserts value is CreateSaleRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as CreateSaleRequest).items)
  ) {
    throw new Error('Invalid sale request: "items" must be an array')
  }
  for (const item of (value as CreateSaleRequest).items as CartItemInput[]) {
    if (
      typeof item?.productId !== 'string' ||
      !Number.isFinite(item?.quantity) ||
      item.quantity <= 0 ||
      !Number.isInteger(item?.unitPriceCents) ||
      item.unitPriceCents < 0 ||
      (item.accountingGroupId != null && typeof item.accountingGroupId !== 'string')
    ) {
      throw new Error('Invalid sale item in request')
    }
  }
  const payment = (value as CreateSaleRequest).payment
  if (
    typeof payment !== 'object' ||
    payment === null ||
    !Number.isInteger(payment.cashCents) ||
    !Number.isInteger(payment.cardCents) ||
    !Number.isInteger(payment.creditCents) ||
    payment.cashCents < 0 ||
    payment.cardCents < 0 ||
    payment.creditCents < 0 ||
    (payment.clientId != null && typeof payment.clientId !== 'string')
  ) {
    throw new Error('Invalid sale payment in request')
  }
}

function isCartState(value: unknown): value is CartState {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as CartState).lines) &&
    Number.isFinite((value as CartState).totalCents)
  )
}

/**
 * Enrolment handlers — registered at startup, BEFORE any database exists, since
 * the setup screen runs before the terminal is enrolled (and thus before the
 * encrypted DB can be opened).
 */
export function registerEnrollmentHandlers(enrollment: EnrollmentService): void {
  ipcMain.handle(IpcChannels.enrollmentGetState, () => enrollment.getState())

  ipcMain.handle(IpcChannels.enrollmentTestConnection, (_event, syncApiUrl: unknown) => {
    if (typeof syncApiUrl !== 'string' || syncApiUrl.trim().length === 0) {
      throw new Error('Invalid backend URL')
    }
    return enrollment.testConnection(syncApiUrl)
  })

  ipcMain.handle(IpcChannels.enrollmentEnroll, (_event, request: unknown) => {
    const { syncApiUrl, terminalId, code } = (request ?? {}) as Partial<EnrollRequest>
    if (
      typeof syncApiUrl !== 'string' ||
      typeof terminalId !== 'string' ||
      typeof code !== 'string' ||
      !syncApiUrl.trim() ||
      !terminalId.trim() ||
      !code.trim()
    ) {
      throw new Error('Invalid enrolment request')
    }
    return enrollment.enroll(syncApiUrl.trim(), terminalId.trim(), code.trim())
  })

  ipcMain.handle(IpcChannels.enrollmentReset, () => enrollment.reset())

  ipcMain.handle(IpcChannels.enrollmentUpdateUrl, (_event, syncApiUrl: unknown) => {
    if (typeof syncApiUrl !== 'string' || !syncApiUrl.trim()) {
      throw new Error('Invalid backend URL')
    }
    let parsed: URL
    try {
      parsed = new URL(syncApiUrl.trim())
    } catch {
      throw new Error('Invalid backend URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('La URL debe empezar por http:// o https://')
    }
    return enrollment.updateSyncApiUrl(syncApiUrl.trim())
  })
}

/**
 * Database-backed handlers — registered only once the encrypted DB is open (i.e.
 * after enrolment). Each channel maps 1:1 to a method on the `IpcApi` surface.
 */
export function registerDbHandlers(
  db: DB,
  customerDisplay: CustomerDisplayManager,
  getSyncApiUrl: () => string
): void {
  const auth = new AuthService(db, getSyncApiUrl)

  ipcMain.handle(IpcChannels.authLogin, (_event, username: unknown, password: unknown) => {
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim()) {
      throw new Error('Invalid login request')
    }
    return auth.login(username.trim(), password)
  })

  ipcMain.handle(IpcChannels.productsList, () => listProducts(db))

  ipcMain.handle(IpcChannels.categoriesList, () => listCategories(db))

  ipcMain.handle(IpcChannels.productsGetByBarcode, (_event, barcode: unknown) => {
    if (typeof barcode !== 'string') {
      throw new Error('Invalid barcode')
    }
    return getProductByBarcode(db, barcode)
  })

  ipcMain.handle(IpcChannels.salesCreate, (_event, request: unknown) => {
    assertCreateSaleRequest(request)
    // The terminal prefix comes from the persisted settings, not a static env.
    return createSale(db, getSettings(db).terminalId, request)
  })

  ipcMain.handle(IpcChannels.zReportPreview, () => previewZReport(db))

  ipcMain.handle(IpcChannels.zReportClose, () => closeZReport(db, getSettings(db).terminalId))

  ipcMain.handle(IpcChannels.zReportHistory, () => listZClosures(db))

  // Fire-and-forget cart mirror from the cashier window.
  ipcMain.on(IpcChannels.customerDisplayUpdate, (_event, state: unknown) => {
    if (isCartState(state)) {
      customerDisplay.update(state)
    }
  })

  ipcMain.handle(IpcChannels.settingsGet, () => getSettings(db))

  ipcMain.handle(IpcChannels.settingsUpdate, (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) {
      throw new Error('Invalid settings patch')
    }
    const settings = updateSettings(db, patch as Partial<AppSettings>)
    // Reflect the customer-display toggle on the actual window immediately.
    customerDisplay.setEnabled(settings.customerDisplayEnabled)
    return settings
  })
}
