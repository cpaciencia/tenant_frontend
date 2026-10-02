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
  SyncStatus,
  SyncResyncResult,
  CatalogRefreshResult,
  CashSession,
  OpenSessionRequest,
  CloseSessionRequest,
  CloseSessionResult,
  PendingItem,
  ResolvePendingRequest,
  AuditEventInput,
  ParkTicketRequest,
  CashMovement,
  CashMovementsSummary,
  RecordCashMovementRequest,
  MarkInvoiceUploadedRequest,
  AccountPayment,
  InternalAccount,
  InternalConsumption,
  RecordConsumptionRequest,
  Client,
  ClientAccount,
  CreateClientRequest,
  SettleDebtRequest,
  Supplier,
  ParkedTicket,
  ParkedTicketActionRequest,
  AcceptSessionRequest,
  SessionArqueo,
  PdfExportResult
} from './types'

/**
 * IPC channel names. Defined once and reused by both ends so a typo can't
 * silently break a call.
 */
export const IpcChannels = {
  productsList: 'products:list',
  productsGetByBarcode: 'products:get-by-barcode',
  productsSalesRanking: 'products:sales-ranking',
  categoriesList: 'categories:list',
  salesCreate: 'sales:create',
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
  authLogin: 'auth:login',
  // Outbound sync: queue status + force a full re-push (e.g. after a backend reset).
  syncStatus: 'sync:status',
  syncResync: 'sync:resync',
  // Inbound catalog: clean full re-pull that replaces the local mirrors.
  catalogRefresh: 'catalog:refresh',
  // Cash sessions (caja por turno): open, current, live arqueo, close, history.
  cashSessionOpen: 'cash-session:open',
  cashSessionCurrent: 'cash-session:current',
  cashSessionLastFloat: 'cash-session:last-float',
  cashSessionAccept: 'cash-session:accept',
  cashSessionArqueo: 'cash-session:arqueo',
  cashSessionClose: 'cash-session:close',
  cashSessionHistory: 'cash-session:history',
  // Render a self-contained HTML document to PDF and let the user save it.
  printSavePdf: 'print:save-pdf',
  // Lines sold without a catalog product, waiting to be completed or dismissed.
  pendingItemsList: 'pending-items:list',
  pendingItemsComplete: 'pending-items:complete',
  pendingItemsDismiss: 'pending-items:dismiss',
  // Supplier payments and cash in/out of the open caja.
  cashMovementsRecord: 'cash-movements:record',
  cashMovementsCurrent: 'cash-movements:current',
  cashMovementsSuppliers: 'cash-movements:suppliers',
  cashMovementsInvoiceUploaded: 'cash-movements:invoice-uploaded',
  clientsList: 'clients:list',
  clientsCreate: 'clients:create',
  clientsAccount: 'clients:account',
  clientsRefresh: 'clients:refresh',
  clientsSettle: 'clients:settle',
  internalAccounts: 'internal:accounts',
  internalStaff: 'internal:staff',
  internalRecord: 'internal:record',
  // Tickets set aside unpaid and resumed later.
  parkedList: 'parked:list',
  parkedPark: 'parked:park',
  parkedResume: 'parked:resume',
  parkedDiscard: 'parked:discard',
  // UI actions the Main process can't see (voids, logout, scan misses…).
  auditRecord: 'audit:record'
} as const

/**
 * The exact surface exposed on `window.api`. Deliberately narrow: the renderer
 * can only do what these methods allow — it never sees Node, the filesystem, or
 * the database. Adding a capability means adding a method here AND a handler in
 * `src/main/ipc`.
 */
export interface IpcApi {
  /**
   * The channel names this preload/Main build knows. The renderer hot-reloads in
   * dev but Main/preload don't: comparing against the renderer's own
   * `IpcChannels` detects a stale Main and asks for a restart (see App.vue).
   */
  ipcChannels: string[]
  products: {
    list: () => Promise<Product[]>
    getByBarcode: (barcode: string) => Promise<Product | null>
    /** Units sold per product on this terminal (best sellers first in the grid). */
    salesRanking: () => Promise<Record<string, number>>
  }
  categories: {
    /** Active categories mirrored locally (for the POS grid, works offline). */
    list: () => Promise<Category[]>
  }
  sales: {
    create: (request: CreateSaleRequest) => Promise<Sale>
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
  sync: {
    /** Current outbound queue counts (pending vs total). */
    status: () => Promise<SyncStatus>
    /**
     * Re-queue every local sale/cierre and push now. Use after the backend
     * database was wiped/reset so the cloud gets the local history back. Ingestion
     * is idempotent, so this is safe to run repeatedly.
     */
    resyncAll: () => Promise<SyncResyncResult>
  }
  catalog: {
    /**
     * Clean full re-pull: replaces the local catalog/user mirrors with the backend's
     * current set, removing orphan rows (the duplicates seen in the POS grid after a
     * backend reset/re-import). Best-effort per entity; an unreachable entity is left
     * untouched (its count comes back null).
     */
    refresh: () => Promise<CatalogRefreshResult>
  }
  cashSession: {
    /** Open the terminal's caja for a shift (only when none is open, e.g. first run). */
    open: (request: OpenSessionRequest) => Promise<CashSession>
    /** The terminal's open caja (one drawer → at most one), or null. */
    current: () => Promise<CashSession | null>
    /** Float left in the drawer by the last cierre, or null if there was none. */
    lastClosingFloat: () => Promise<number | null>
    /** Take responsibility for the open caja a previous cierre left without one. */
    accept: (request: AcceptSessionRequest) => Promise<CashSession>
    /** Live arqueo of an open caja (totals + expected cash), without sealing it. */
    arqueo: (sessionId: string) => Promise<SessionArqueo>
    /** Seal a caja and open the next shift's caja with the float left. */
    close: (request: CloseSessionRequest) => Promise<CloseSessionResult>
    /** Past + present cajas, newest first. */
    history: () => Promise<CashSession[]>
  }
  print: {
    /** Render a self-contained HTML document to PDF and ask where to save it. */
    savePdf: (html: string, fileName: string) => Promise<PdfExportResult>
  }
  pendingItems: {
    /** Lines sold by price only ("Producto" (no barcode) / barcode not found) still open. */
    list: () => Promise<PendingItem[]>
    /** Link a pending line to the product just created for it. */
    complete: (request: ResolvePendingRequest) => Promise<PendingItem>
    /** Drop a pending line without creating a product. */
    dismiss: (request: ResolvePendingRequest) => Promise<PendingItem>
  }
  cashMovements: {
    /** Pay a supplier from the drawer, or put money in / take it out. */
    record: (request: RecordCashMovementRequest) => Promise<CashMovement>
    /** Movements of the open caja and the money put in still to be taken out. */
    current: () => Promise<CashMovementsSummary>
    /** Suppliers to pick from (a new name typed in a payment is added). */
    suppliers: () => Promise<Supplier[]>
    /** The server confirmed it stores this supplier payment's invoice. */
    markInvoiceUploaded: (request: MarkInvoiceUploadedRequest) => Promise<CashMovement>
  }
  clients: {
    /** "A cuenta" clients with what they owe (all terminals; exact offline). */
    list: () => Promise<Client[]>
    /** Add a client at the till (works offline; synced). */
    create: (request: CreateClientRequest) => Promise<Client>
    /** A client's balance and this till's movements. */
    account: (clientId: string) => Promise<ClientAccount>
    /** Re-pull clients and their balances from the server (best-effort). */
    refresh: () => Promise<Client[]>
    /** The client pays (part of) their debt, without a purchase. */
    settle: (request: SettleDebtRequest) => Promise<AccountPayment>
  }
  internal: {
    /** Internal accounts to charge goods to ("Limpieza"…). */
    accounts: () => Promise<InternalAccount[]>
    /** Staff names (who can take goods). */
    staff: () => Promise<string[]>
    /** Record the open ticket as internal consumption (not a sale). */
    record: (request: RecordConsumptionRequest) => Promise<InternalConsumption>
  }
  parked: {
    /** Tickets parked on this terminal, oldest first. */
    list: () => Promise<ParkedTicket[]>
    /** Set the current unpaid ticket aside (to serve someone else). */
    park: (request: ParkTicketRequest) => Promise<ParkedTicket>
    /** Take a parked ticket back (it leaves the parked list). */
    resume: (request: ParkedTicketActionRequest) => Promise<ParkedTicket>
    /** Throw a parked ticket away unpaid (audited). */
    discard: (request: ParkedTicketActionRequest) => Promise<ParkedTicket>
  }
  audit: {
    /** Record a UI action in the append-only audit log (fire-and-forget). */
    record: (event: AuditEventInput) => Promise<void>
  }
}
