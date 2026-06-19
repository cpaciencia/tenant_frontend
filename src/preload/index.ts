import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels, type IpcApi } from '../shared/ipc'
import type { AppSettings, CartState, CreateSaleRequest, EnrollRequest } from '../shared/types'

// Narrow, typed API exposed to the renderer. Each method is a thin wrapper over
// ipcRenderer — no Node, fs, or DB access leaks across the bridge.
const api: IpcApi = {
  products: {
    list: () => ipcRenderer.invoke(IpcChannels.productsList),
    getByBarcode: (barcode: string) => ipcRenderer.invoke(IpcChannels.productsGetByBarcode, barcode)
  },
  categories: {
    list: () => ipcRenderer.invoke(IpcChannels.categoriesList)
  },
  sales: {
    create: (request: CreateSaleRequest) => ipcRenderer.invoke(IpcChannels.salesCreate, request)
  },
  zReport: {
    preview: () => ipcRenderer.invoke(IpcChannels.zReportPreview),
    close: () => ipcRenderer.invoke(IpcChannels.zReportClose),
    history: () => ipcRenderer.invoke(IpcChannels.zReportHistory)
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
