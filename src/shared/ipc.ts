import type {
  Product,
  Category,
  CreateSaleRequest,
  Sale,
  CartState,
  AppSettings,
  EnrollmentState,
  ConnectionTestResult,
  EnrollRequest,
  EnrollResult,
  AuthSessionResult,
  ZReport,
  ZClosure
} from './types'

/**
 * IPC channel names. Defined once and reused by both ends so a typo can't
 * silently break a call.
 */
export const IpcChannels = {
  productsList: 'products:list',
  productsGetByBarcode: 'products:get-by-barcode',
  categoriesList: 'categories:list',
  salesCreate: 'sales:create',
  // Cash-up (Z) report: live preview, seal a closure, list history.
  zReportPreview: 'z-report:preview',
  zReportClose: 'z-report:close',
  zReportHistory: 'z-report:history',
  // Cashier window -> Main: push the latest cart snapshot.
  customerDisplayUpdate: 'customer-display:update',
  // Main -> customer-display window: render this cart snapshot.
  customerDisplayState: 'customer-display:state',
  // Read the persisted per-terminal settings.
  settingsGet: 'settings:get',
  // Apply a partial update and return the merged settings.
  settingsUpdate: 'settings:update',
  // Terminal enrolment (pre-login setup).
  enrollmentGetState: 'enrollment:get-state',
  enrollmentTestConnection: 'enrollment:test-connection',
  enrollmentEnroll: 'enrollment:enroll',
  enrollmentReset: 'enrollment:reset',
  enrollmentUpdateUrl: 'enrollment:update-url',
  // Authentication (offline-first login + effective permissions).
  authLogin: 'auth:login'
} as const

/**
 * The exact surface exposed on `window.api`. Deliberately narrow: the renderer
 * can only do what these methods allow — it never sees Node, the filesystem, or
 * the database. Adding a capability means adding a method here AND a handler in
 * `src/main/ipc`.
 */
export interface IpcApi {
  products: {
    list: () => Promise<Product[]>
    getByBarcode: (barcode: string) => Promise<Product | null>
  }
  categories: {
    /** Active categories mirrored locally (for the POS grid, works offline). */
    list: () => Promise<Category[]>
  }
  sales: {
    create: (request: CreateSaleRequest) => Promise<Sale>
  }
  zReport: {
    /** Live preview of the next cash-up (does not seal anything). */
    preview: () => Promise<ZReport>
    /** Seal a cash-up closure and return it. Throws if there's nothing to close. */
    close: () => Promise<ZClosure>
    /** Past closures, newest first. */
    history: () => Promise<ZClosure[]>
  }
  customerDisplay: {
    /** Cashier side: mirror the current cart to the customer display. */
    update: (state: CartState) => void
    /** Customer-display side: subscribe to cart updates. Returns an unsubscribe fn. */
    onState: (callback: (state: CartState) => void) => () => void
  }
  settings: {
    /** Read the current persisted settings. */
    get: () => Promise<AppSettings>
    /** Persist a partial change; returns the full merged settings. */
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  enrollment: {
    /** Current enrolment status (drives the setup-before-login routing). */
    getState: () => Promise<EnrollmentState>
    /** Probe whether a candidate backend URL is reachable. */
    testConnection: (syncApiUrl: string) => Promise<ConnectionTestResult>
    /** Redeem an enrolment code; on success stores the issued credentials. */
    enroll: (request: EnrollRequest) => Promise<EnrollResult>
    /** Forget the stored credentials (re-enrol from scratch). */
    reset: () => Promise<EnrollmentState>
    /** Change the backend URL without re-enrolling (same server, new address). */
    updateSyncApiUrl: (syncApiUrl: string) => Promise<EnrollmentState>
  }
  auth: {
    /** Log in (online if reachable, else offline against the local mirror). */
    login: (username: string, password: string) => Promise<AuthSessionResult>
  }
}
