import type { PdfExportResult } from '../../../shared/types'
import {
  buildCierreReportHtml,
  cierreFileName,
  type CierreReportData,
  type ReportBusiness
} from './cierreReport'

/** Business header for documents, from the terminal settings (web: shim defaults). */
export async function loadReportBusiness(): Promise<ReportBusiness> {
  try {
    const settings = await window.api.settings.get()
    return {
      name: settings.businessName,
      address: settings.businessAddress,
      taxId: settings.businessTaxId
    }
  } catch {
    return { name: '' }
  }
}

/** Export a cierre to PDF (desktop: save dialog; web: the browser's print → PDF). */
export async function exportCierrePdf(
  cierre: CierreReportData,
  business: ReportBusiness
): Promise<PdfExportResult> {
  return window.api.print.savePdf(buildCierreReportHtml(cierre, business), cierreFileName(cierre))
}
