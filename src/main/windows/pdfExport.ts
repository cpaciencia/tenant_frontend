import { app, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PdfExportResult } from '../../shared/types'

/** Upper bound for a renderer-supplied document (a cierre is a few KB). */
export const MAX_PDF_HTML_LENGTH = 2 * 1024 * 1024

/** Reduce a suggested name to a safe file name ending in .pdf. */
export function safePdfFileName(name: string): string {
  const base =
    name
      .replace(/[^\p{L}\p{N} ._-]+/gu, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 100) || 'documento'
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`
}

/**
 * Render a self-contained HTML document in a hidden, script-less window, print it
 * to PDF and ask the user where to save it. The renderer never touches the
 * filesystem: it only hands over the document.
 */
export async function exportHtmlToPdf(
  parent: BrowserWindow | null,
  html: string,
  fileName: string
): Promise<PdfExportResult> {
  const offscreen = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true }
  })
  let pdf: Buffer
  try {
    await offscreen.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    pdf = await offscreen.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    offscreen.destroy()
  }

  const options = {
    title: 'Guardar PDF',
    defaultPath: join(app.getPath('documents'), safePdfFileName(fileName)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }
  const choice = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (choice.canceled || !choice.filePath) {
    return { saved: false }
  }
  await writeFile(choice.filePath, pdf)
  return { saved: true, path: choice.filePath }
}
