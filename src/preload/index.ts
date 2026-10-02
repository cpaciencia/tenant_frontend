import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels, type IpcApi } from '../shared/ipc'
import type { AppSettings, CartState, CreateSaleRequest, EnrollRequest } from '../shared/types'

// Narrow, typed API exposed to the renderer. Each method is a thin wrapper over
// ipcRenderer — no Node, fs, or DB access leaks across the bridge.
const api: IpcApi = {
  ipcChannels: Object.values(IpcChannels),
  products: {
    list: () => ipcRenderer.invoke(IpcChannels.productsList),
    getByBarcode: (barcode: string) =>
      ipcRenderer.invoke(IpcChannels.productsGetByBarcode, barcode),
    salesRanking: () => ipcRenderer.invoke(IpcChannels.productsSalesRanking)
  },
  categories: {
    list: () => ipcRenderer.invoke(IpcChannels.categoriesList)
  },
  sales: {
    create: (request: CreateSaleRequest) => ipcRenderer.invoke(IpcChannels.salesCreate, request)
  },
  customerDisplay: {
    update: (state: CartState) => ipcRenderer.send(IpcChannels.customerDisplayUpdate, state),
    onState: (callback: (state: CartState) => void) => {
      const listener = (_event: IpcRendererEvent, state: CartState): void => callback(state)
      ipcRenderer.on(IpcChannels.customerDisplayState, listener)
      return () => ipcRenderer.removeListener(IpcChannels.customerDisplayState, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch)
  },
  enrollment: {
    getState: () => ipcRenderer.invoke(IpcChannels.enrollmentGetState),
    testConnection: (syncApiUrl: string) =>
      ipcRenderer.invoke(IpcChannels.enrollmentTestConnection, syncApiUrl),
    enroll: (request: EnrollRequest) => ipcRenderer.invoke(IpcChannels.enrollmentEnroll, request),
    reset: () => ipcRenderer.invoke(IpcChannels.enrollmentReset),
    updateSyncApiUrl: (syncApiUrl: string) =>
      ipcRenderer.invoke(IpcChannels.enrollmentUpdateUrl, syncApiUrl)
  },
  auth: {
    login: (username: string, password: string) =>
      ipcRenderer.invoke(IpcChannels.authLogin, username, password)
  },
  sync: {
    status: () => ipcRenderer.invoke(IpcChannels.syncStatus),
    resyncAll: () => ipcRenderer.invoke(IpcChannels.syncResync)
  },
  catalog: {
    refresh: () => ipcRenderer.invoke(IpcChannels.catalogRefresh)
  },
  cashSession: {
    open: (request) => ipcRenderer.invoke(IpcChannels.cashSessionOpen, request),
    current: () => ipcRenderer.invoke(IpcChannels.cashSessionCurrent),
    lastClosingFloat: () => ipcRenderer.invoke(IpcChannels.cashSessionLastFloat),
    accept: (request) => ipcRenderer.invoke(IpcChannels.cashSessionAccept, request),
    arqueo: (sessionId: string) => ipcRenderer.invoke(IpcChannels.cashSessionArqueo, sessionId),
    close: (request) => ipcRenderer.invoke(IpcChannels.cashSessionClose, request),
    history: () => ipcRenderer.invoke(IpcChannels.cashSessionHistory)
  },
  print: {
    savePdf: (html: string, fileName: string) =>
      ipcRenderer.invoke(IpcChannels.printSavePdf, html, fileName)
  },
  pendingItems: {
    list: () => ipcRenderer.invoke(IpcChannels.pendingItemsList),
    complete: (request) => ipcRenderer.invoke(IpcChannels.pendingItemsComplete, request),
    dismiss: (request) => ipcRenderer.invoke(IpcChannels.pendingItemsDismiss, request)
  },
  clients: {
    list: () => ipcRenderer.invoke(IpcChannels.clientsList),
    create: (request) => ipcRenderer.invoke(IpcChannels.clientsCreate, request),
    account: (clientId) => ipcRenderer.invoke(IpcChannels.clientsAccount, clientId),
    refresh: () => ipcRenderer.invoke(IpcChannels.clientsRefresh),
    settle: (request) => ipcRenderer.invoke(IpcChannels.clientsSettle, request)
  },
  cashMovements: {
    record: (request) => ipcRenderer.invoke(IpcChannels.cashMovementsRecord, request),
    current: () => ipcRenderer.invoke(IpcChannels.cashMovementsCurrent),
    suppliers: () => ipcRenderer.invoke(IpcChannels.cashMovementsSuppliers),
    markInvoiceUploaded: (request) =>
      ipcRenderer.invoke(IpcChannels.cashMovementsInvoiceUploaded, request)
  },
  parked: {
    list: () => ipcRenderer.invoke(IpcChannels.parkedList),
    park: (request) => ipcRenderer.invoke(IpcChannels.parkedPark, request),
    resume: (request) => ipcRenderer.invoke(IpcChannels.parkedResume, request),
    discard: (request) => ipcRenderer.invoke(IpcChannels.parkedDiscard, request)
  },
  audit: {
    record: (event) => ipcRenderer.invoke(IpcChannels.auditRecord, event)
  }
}

// Use `contextBridge` APIs to expose APIs to the renderer only if context
// isolation is enabled, otherwise just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
