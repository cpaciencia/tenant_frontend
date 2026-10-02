/**
 * The cierre de caja document. ONE self-contained HTML string is both what the
 * cashier sees on screen (rendered in an iframe) and what is exported to PDF, so
 * the two can never drift. Shared by the POS (desktop) and the Backoffice (web +
 * desktop), hence the structural input type that fits both the local CashSession
 * and the backend's CashSessionView.
 */

interface ReportTenders {
  cashCents: number
  cardCents: number
  creditCents: number
}

export interface CierreReportData {
  zNumber: number | null
  terminalId: string
  shiftName?: string | null
  businessDate?: string | null
  cashierName: string
  closedByName?: string | null
  responsibleName?: string | null
  openedAt: string
  closedAt: string | null
  openingFloatCents: number
  salesCount: number
  totalCents: number
  tenders: ReportTenders
  breakdown: { code: string; name: string; totalCents: number }[]
  fiados?: { ticketNumber: string; clientName: string; amountCents: number }[] | null
  sellers?: { name: string; salesCount: number; totalCents: number }[] | null
  floatAdjustments?: { at: string; userName: string; fromCents: number; toCents: number }[] | null
  /** Supplier payments and cash in/out (not sales). */
  cashMovements?:
    | {
        kind: string
        amountCents: number
        supplier: string | null
        document: string | null
        note: string | null
        userName: string
        createdAt: string
      }[]
    | null
  expectedCashCents: number | null
  countedCashCents: number | null
  differenceCents: number | null
  closingFloatCents: number | null
}

export interface ReportBusiness {
  name: string
  address?: string
  taxId?: string
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function eur(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function dateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
    : '—'
}

/** "2026-10-01" → "01/10/2026" without timezone shifts. */
function businessDay(date: string | null | undefined): string {
  if (!date) return ''
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

export function cierreTitle(s: CierreReportData): string {
  if (s.closedAt === null) return 'Caja abierta'
  return `Cierre ${s.zNumber != null ? `Z ${s.zNumber}` : ''}`.trim()
}

export function cierreShiftLabel(s: Pick<CierreReportData, 'shiftName' | 'businessDate'>): string {
  return [s.shiftName, businessDay(s.businessDate)].filter(Boolean).join(' · ') || 'Sin turno'
}

/** Suggested PDF file name, e.g. "cierre-T01-Z12-2026-10-01-manana". */
export function cierreFileName(s: CierreReportData): string {
  const shift = (s.shiftName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return [
    s.closedAt === null ? 'caja-abierta' : 'cierre',
    s.terminalId,
    s.zNumber != null ? `Z${s.zNumber}` : '',
    s.businessDate,
    shift
  ]
    .filter(Boolean)
    .join('-')
}

function row(label: string, value: string, cls = ''): string {
  return `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${value}</td></tr>`
}

export function buildCierreReportHtml(s: CierreReportData, business: ReportBusiness): string {
  // An open caja (seen live from the backoffice) has no arqueo yet: the document
  // shows its state "as of now" instead of a cierre.
  const isOpen = s.closedAt === null
  const fiados = s.fiados ?? []
  // Float corrections made while the caja was open: always visible on the cierre.
  const movements = s.cashMovements ?? []
  const movementTotal = (kind: string): number =>
    movements.filter((m) => m.kind === kind).reduce((n, m) => n + m.amountCents, 0)
  const MOVEMENT_LABEL: Record<string, string> = {
    supplier_payment: 'Pago a proveedor',
    cash_in: 'Entrada de dinero',
    cash_out: 'Retirada de dinero'
  }
  const movementArqueoRows = [
    movementTotal('cash_in') ? row('+ Entradas de dinero', eur(movementTotal('cash_in'))) : '',
    movementTotal('supplier_payment')
      ? row('− Pagos a proveedores', eur(movementTotal('supplier_payment')))
      : '',
    movementTotal('cash_out') ? row('− Retiradas de dinero', eur(movementTotal('cash_out'))) : ''
  ].join('')
  const movementRows = movements.length
    ? movements
        .map(
          (m) =>
            `<tr><td>${esc(MOVEMENT_LABEL[m.kind] ?? m.kind)}${m.supplier ? ` · ${esc(m.supplier)}` : ''}${m.document ? ` <span class="muted">(${esc(m.document)})</span>` : ''}${m.note ? ` <span class="muted">${esc(m.note)}</span>` : ''}<br><span class="muted">${esc(dateTime(m.createdAt))} · ${esc(m.userName)}</span></td>` +
            `<td class="num">${m.kind === 'cash_in' ? '+' : '−'}${eur(m.amountCents)}</td></tr>`
        )
        .join('')
    : ''
  const adjustmentRows = (s.floatAdjustments ?? [])
    .map(
      (a) =>
        `<tr class="adjust"><td>Fondo corregido · ${esc(a.userName)}, ${esc(dateTime(a.at))}</td>` +
        `<td class="num">${eur(a.fromCents)} → ${eur(a.toCents)}</td></tr>`
    )
    .join('')
  const sellers = s.sellers ?? []
  const diff = s.differenceCents ?? 0
  const diffLabel = diff === 0 ? 'Cuadra' : diff > 0 ? 'Sobra' : 'Falta'
  const diffCls = diff === 0 ? 'ok' : diff > 0 ? 'over' : 'short'
  const toEnvelope = Math.max(0, (s.countedCashCents ?? 0) - (s.closingFloatCents ?? 0))

  const breakdownRows = s.breakdown.length
    ? s.breakdown
        .map(
          (b) =>
            `<tr><td><b>${esc(b.code)}</b> ${esc(b.name)}</td><td class="num">${eur(b.totalCents)}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="2" class="empty">Sin ventas</td></tr>`

  const fiadoRows = fiados.length
    ? fiados
        .map(
          (f) =>
            `<tr><td>${esc(f.clientName)}</td><td class="muted">${esc(f.ticketNumber)}</td><td class="num">${eur(f.amountCents)}</td></tr>`
        )
        .join('') +
      `<tr class="total"><td colspan="2">Total a cuenta</td><td class="num">${eur(s.tenders.creditCents)}</td></tr>`
    : `<tr><td colspan="3" class="empty">No hay ventas a cuenta en esta caja</td></tr>`

  const sellerRows = sellers.length
    ? sellers
        .map(
          (v) =>
            `<tr><td>${esc(v.name)}</td><td class="num">${v.salesCount}</td><td class="num">${eur(v.totalCents)}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="3" class="empty">Sin ventas</td></tr>`

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(cierreTitle(s))}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #1e293b; font-size: 12.5px; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
          border-bottom: 2px solid #1f4d2e; padding-bottom: 10px; margin-bottom: 14px; }
  .biz { font-size: 15px; font-weight: 800; color: #1f4d2e; }
  .biz small { display: block; font-size: 11px; font-weight: 500; color: #64748b; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 20px; color: #1f4d2e; letter-spacing: .02em; }
  .title div { font-size: 12px; color: #475569; font-weight: 600; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; margin-bottom: 14px; }
  .meta div { display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 3px 0; }
  .meta span { color: #64748b; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #1f4d2e; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 2px; border-bottom: 1px solid #eef2f6; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .muted { color: #64748b; font-size: 11px; }
  .empty { color: #94a3b8; font-style: italic; }
  tr.total td { font-weight: 800; border-top: 1.5px solid #1e293b; border-bottom: none; }
  tr.strong td { font-weight: 800; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 4px; }
  .kpi { background: #f4f7f9; border-radius: 8px; padding: 8px 10px; }
  .kpi span { display: block; font-size: 10.5px; color: #64748b; font-weight: 700; text-transform: uppercase; }
  .kpi b { font-size: 15px; }
  .diff td { font-weight: 900; font-size: 13.5px; }
  .diff.ok td { color: #15803d; } .diff.over td { color: #b45309; } .diff.short td { color: #b91c1c; }
  tr.adjust td { font-size: 11px; color: #b45309; font-weight: 700; }
  .envelope td { font-weight: 900; font-size: 14px; background: #f0fdf4; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
  .sign div { border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 11px; color: #64748b; text-align: center; }
</style></head>
<body>
  <div class="head">
    <div class="biz">${esc(business.name)}
      ${business.address ? `<small>${esc(business.address)}</small>` : ''}
      ${business.taxId ? `<small>CIF/NIF ${esc(business.taxId)}</small>` : ''}
    </div>
    <div class="title"><h1>${isOpen ? 'CAJA ABIERTA' : `CIERRE DE CAJA${s.zNumber != null ? ` · Z ${s.zNumber}` : ''}`}</h1>
      <div>${esc(cierreShiftLabel(s))}</div></div>
  </div>

  <div class="meta">
    <div><span>Terminal</span><b>${esc(s.terminalId)}</b></div>
    <div><span>Turno</span><b>${esc(cierreShiftLabel(s))}</b></div>
    <div><span>Responsable</span><b>${esc(s.responsibleName || s.closedByName || '—')}</b></div>
    <div><span>Ventas</span><b>${s.salesCount}</b></div>
    <div><span>Apertura</span><b>${esc(dateTime(s.openedAt))} · ${esc(s.cashierName)}</b></div>
    ${
      isOpen
        ? `<div><span>Estado</span><b>Abierta · a ${esc(dateTime(new Date().toISOString()))}</b></div>`
        : `<div><span>Cierre</span><b>${esc(dateTime(s.closedAt))}${s.closedByName ? ` · ${esc(s.closedByName)}` : ''}</b></div>`
    }
  </div>

  <div class="kpis">
    <div class="kpi"><span>Ventas</span><b>${s.salesCount}</b></div>
    <div class="kpi"><span>Total</span><b>${eur(s.totalCents)}</b></div>
    <div class="kpi"><span>Efectivo</span><b>${eur(s.tenders.cashCents)}</b></div>
    <div class="kpi"><span>Tarjeta</span><b>${eur(s.tenders.cardCents)}</b></div>
  </div>

  <div class="cols">
    <div>
      <h2>Por grupo contable</h2>
      <table>${breakdownRows}
        <tr class="total"><td>Total</td><td class="num">${eur(s.totalCents)}</td></tr></table>

      <h2>Formas de pago</h2>
      <table>
        ${row('Efectivo', eur(s.tenders.cashCents))}
        ${row('Tarjeta', eur(s.tenders.cardCents))}
        ${row('A cuenta', eur(s.tenders.creditCents))}
        <tr class="total"><td>Total</td><td class="num">${eur(s.totalCents)}</td></tr>
      </table>

      <h2>Vendido por</h2>
      <table>${sellerRows}</table>
    </div>
    <div>
      <h2>Arqueo de efectivo</h2>
      <table>
        ${row('Fondo de apertura', eur(s.openingFloatCents))}
        ${adjustmentRows}
        ${row('+ Ventas en efectivo', eur(s.tenders.cashCents))}
        ${movementArqueoRows}
        ${row('Efectivo esperado', eur(s.expectedCashCents), 'strong')}
        ${
          isOpen
            ? `<tr><td colspan="2" class="empty">Pendiente de arqueo: aún no se ha contado el cajón</td></tr>`
            : `${row('Efectivo contado', eur(s.countedCashCents), 'strong')}
        <tr class="diff ${diffCls}"><td>${diffLabel}</td><td class="num">${eur(Math.abs(diff))}</td></tr>
        ${row('Fondo dejado en caja', eur(s.closingFloatCents))}
        <tr class="envelope"><td>A retirar (sobre)</td><td class="num">${eur(toEnvelope)}</td></tr>`
        }
      </table>

      ${movementRows ? `<h2>Movimientos de caja</h2><table>${movementRows}</table>` : ''}

      <h2>Ventas a cuenta</h2>
      <table>${fiadoRows}</table>
    </div>
  </div>

  ${isOpen ? '' : '<div class="sign"><div>Firma de quien cierra</div><div>Firma de quien recibe</div></div>'}
</body></html>`
}
