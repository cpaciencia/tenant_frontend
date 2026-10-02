/**
 * Human-readable rendering of the audit log for the Backoffice "Actividad"
 * section: which group an event type belongs to, its label/icon/tone, a sentence
 * describing what happened, and the amount involved. Pure functions — the
 * single place that knows the shape of each event's `data`.
 */

export type ActivityGroup =
  | 'ventas'
  | 'tickets'
  | 'manual'
  | 'deshechos'
  | 'cajas'
  | 'accesos'
  | 'pendientes'

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'muted'

interface TypeMeta {
  label: string
  icon: string
  group: ActivityGroup
  tone: Tone
}

export const EVENT_TYPES: Record<string, TypeMeta> = {
  'sale.completed': { label: 'Venta', icon: 'pi-shopping-cart', group: 'ventas', tone: 'ok' },
  'ticket.line_added': {
    label: 'Producto añadido',
    icon: 'pi-plus-circle',
    group: 'tickets',
    tone: 'muted'
  },
  'payment.opened': {
    label: 'Cobro abierto',
    icon: 'pi-money-bill',
    group: 'tickets',
    tone: 'info'
  },
  'ticket.parked': { label: 'Ticket aparcado', icon: 'pi-pause', group: 'tickets', tone: 'info' },
  'ticket.resumed': { label: 'Ticket recuperado', icon: 'pi-play', group: 'tickets', tone: 'info' },
  'ticket.parked_discarded': {
    label: 'Aparcado descartado',
    icon: 'pi-trash',
    group: 'deshechos',
    tone: 'danger'
  },
  'product.manual_added': {
    label: 'Producto a mano',
    icon: 'pi-bolt',
    group: 'manual',
    tone: 'warn'
  },
  'scan.not_found': {
    label: 'Código no encontrado',
    icon: 'pi-question-circle',
    group: 'manual',
    tone: 'warn'
  },
  'ticket.line_removed': {
    label: 'Línea quitada',
    icon: 'pi-minus-circle',
    group: 'deshechos',
    tone: 'danger'
  },
  'ticket.qty_decreased': {
    label: 'Cantidad bajada',
    icon: 'pi-minus',
    group: 'deshechos',
    tone: 'danger'
  },
  'ticket.cleared': {
    label: 'Ticket vaciado',
    icon: 'pi-trash',
    group: 'deshechos',
    tone: 'danger'
  },
  'payment.cancelled': {
    label: 'Cobro cancelado',
    icon: 'pi-times-circle',
    group: 'deshechos',
    tone: 'danger'
  },
  'cash.movement': {
    label: 'Movimiento de caja',
    icon: 'pi-arrow-right-arrow-left',
    group: 'cajas',
    tone: 'info'
  },
  'supplier_invoice.uploaded': {
    label: 'Factura de proveedor subida',
    icon: 'pi-file-check',
    group: 'cajas',
    tone: 'info'
  },
  'cash_session.opened': { label: 'Caja abierta', icon: 'pi-wallet', group: 'cajas', tone: 'info' },
  'cash_session.accepted': {
    label: 'Caja aceptada',
    icon: 'pi-user-plus',
    group: 'cajas',
    tone: 'info'
  },
  'cash_session.closed': {
    label: 'Caja cerrada',
    icon: 'pi-calculator',
    group: 'cajas',
    tone: 'info'
  },
  'auth.login': { label: 'Entrada', icon: 'pi-sign-in', group: 'accesos', tone: 'muted' },
  'auth.logout': { label: 'Salida', icon: 'pi-sign-out', group: 'accesos', tone: 'muted' },
  'auth.login_failed': {
    label: 'Login fallido',
    icon: 'pi-lock',
    group: 'accesos',
    tone: 'danger'
  },
  'pending_item.completed': {
    label: 'Pendiente identificado',
    icon: 'pi-check-circle',
    group: 'pendientes',
    tone: 'ok'
  },
  'pending_item.dismissed': {
    label: 'Pendiente borrado',
    icon: 'pi-ban',
    group: 'pendientes',
    tone: 'warn'
  }
}

export const ACTIVITY_GROUPS: { id: ActivityGroup; label: string; icon: string }[] = [
  { id: 'ventas', label: 'Ventas', icon: 'pi-shopping-cart' },
  { id: 'tickets', label: 'Detalle de tickets', icon: 'pi-list' },
  { id: 'manual', label: 'A mano', icon: 'pi-bolt' },
  { id: 'deshechos', label: 'Deshecho antes de cobrar', icon: 'pi-undo' },
  { id: 'cajas', label: 'Cajas', icon: 'pi-wallet' },
  { id: 'accesos', label: 'Accesos', icon: 'pi-sign-in' },
  { id: 'pendientes', label: 'Pendientes', icon: 'pi-inbox' }
]

/** Event types of one group (for the quick filters). */
export function typesOfGroup(group: ActivityGroup): string[] {
  return Object.entries(EVENT_TYPES)
    .filter(([, meta]) => meta.group === group)
    .map(([type]) => type)
}

export function typeMeta(type: string): TypeMeta {
  return EVENT_TYPES[type] ?? { label: type, icon: 'pi-circle', group: 'ventas', tone: 'muted' }
}

type Data = Record<string, unknown>

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

export function eurCents(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function lineText(d: Data, qty = num(d.quantity)): string {
  const name = str(d.name) || 'Sin nombre'
  return `${qty} × ${name}${d.manual ? ' (a mano)' : ''} a ${eurCents(num(d.priceCents))}`
}

const PAYMENT_LABEL: Record<string, string> = {
  efectivo: 'efectivo',
  tarjeta: 'tarjeta',
  mixto: 'pago mixto',
  fiado: 'a cuenta'
}

const SOURCE_LABEL: Record<string, string> = {
  tap: 'tocando el producto',
  scan: 'escaneado',
  search: 'buscado por nombre'
}

function itemsText(data: Data): string {
  const items = Array.isArray(data.items) ? (data.items as Data[]) : []
  return items.map((it) => `${num(it.quantity)} × ${str(it.name) || 'sin nombre'}`).join(', ')
}

function secondsText(seconds: unknown): string {
  const s = num(seconds)
  if (!s) return ''
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`
}

/** One sentence describing the event (without who/when, shown in their own columns). */
export function describeEvent(type: string, data: Data): string {
  switch (type) {
    case 'sale.completed': {
      const manual = num(data.manualLines)
      const parts = [
        `Ticket ${str(data.ticketNumber)}: ${num(data.lines)} línea(s), ${num(data.units)} ud.`
      ]
      const tenders = [
        num(data.cashCents) ? `efectivo ${eurCents(num(data.cashCents))}` : '',
        num(data.cardCents) ? `tarjeta ${eurCents(num(data.cardCents))}` : '',
        num(data.creditCents) ? `a cuenta ${eurCents(num(data.creditCents))}` : ''
      ].filter(Boolean)
      if (tenders.length) parts.push(tenders.join(' + '))
      if (manual) parts.push(`${manual} a mano`)
      return parts.join(' · ')
    }
    case 'product.manual_added':
      return data.kind === 'not_found'
        ? `Vendido por precio un código no encontrado${data.barcode ? ` (${str(data.barcode)})` : ''}: ${num(data.quantity)} × ${str(data.name) || 'sin nombre'} a ${eurCents(num(data.priceCents))}`
        : `Producto sin código: ${num(data.quantity)} × ${eurCents(num(data.priceCents))}`
    case 'scan.not_found':
      return `Escaneado el código ${str(data.barcode)}, que no está en el catálogo`
    case 'ticket.line_removed':
      return `Quitó del ticket ${lineText(data)}${data.afterPaymentOpened ? ' después de abrir el cobro' : ''}`
    case 'ticket.qty_decreased':
      return `Bajó ${num(data.by)} ud. de ${str(data.name) || 'un producto'} (quedaban ${num(data.quantity)})`
    case 'ticket.cleared': {
      const list = itemsText(data)
      const parts = [
        `Vació un ticket sin cobrar de ${num(data.lines)} línea(s) (${eurCents(num(data.totalCents))})${data.reason === 'logout' ? ' al cerrar sesión' : ''}${list ? `: ${list}` : ''}`
      ]
      if (data.paymentOpened) {
        parts.push(
          num(data.maxTenderedCents)
            ? `había abierto el cobro y tecleado ${eurCents(num(data.maxTenderedCents))} en efectivo`
            : 'había abierto el cobro'
        )
      }
      if (secondsText(data.secondsOpen))
        parts.push(`ticket abierto ${secondsText(data.secondsOpen)}`)
      if (num(data.linesRemoved)) parts.push(`${num(data.linesRemoved)} línea(s) quitada(s) antes`)
      return parts.join(' · ')
    }
    case 'payment.cancelled': {
      const tendered = num(data.tenderedCents)
      return `Abrió el cobro de ${eurCents(num(data.totalCents))} (${PAYMENT_LABEL[str(data.method)] ?? str(data.method)}) y lo canceló sin cobrar${tendered ? ` · había tecleado ${eurCents(tendered)} entregados` : ''}${secondsText(data.secondsOpen) ? ` · ${secondsText(data.secondsOpen)} en la pantalla de cobro` : ''}`
    }
    case 'ticket.line_added':
      return `Añadió ${num(data.quantity)} × ${str(data.name)} a ${eurCents(num(data.priceCents))} (${SOURCE_LABEL[str(data.source)] ?? str(data.source)})`
    case 'payment.opened':
      return `Abrió el cobro de ${eurCents(num(data.totalCents))} (${num(data.lines)} línea(s))`
    case 'ticket.parked':
      return `Aparcó un ticket de ${num(data.lines)} línea(s) (${eurCents(num(data.totalCents))}): ${itemsText(data)}`
    case 'ticket.resumed':
      return `Recuperó el ticket aparcado por ${str(data.parkedByName)} hace ${num(data.minutesParked)} min (${eurCents(num(data.totalCents))}): ${itemsText(data)}`
    case 'ticket.parked_discarded':
      return `Descartó sin cobrar un ticket aparcado por ${str(data.parkedByName)} (${eurCents(num(data.totalCents))}): ${itemsText(data)}`
    case 'cash_session.opened':
      return data.handover
        ? `Abierta la caja ${str(data.shiftName)} ${str(data.businessDate)} al cerrar la anterior · fondo ${eurCents(num(data.floatCents))}`
        : `Abrió la caja ${str(data.shiftName)} ${str(data.businessDate)} con fondo ${eurCents(num(data.floatCents))}`
    case 'cash_session.accepted': {
      const left = num(data.floatLeftCents)
      const counted = num(data.floatCountedCents)
      return left === counted
        ? `Se hizo responsable de la caja ${str(data.shiftName)} ${str(data.businessDate)} · fondo ${eurCents(counted)}`
        : `Se hizo responsable de la caja ${str(data.shiftName)} ${str(data.businessDate)} y corrigió el fondo ${eurCents(left)} → ${eurCents(counted)}`
    }
    case 'cash_session.closed': {
      const diff = num(data.differenceCents)
      const diffText =
        diff === 0 ? 'cuadra' : diff > 0 ? `sobran ${eurCents(diff)}` : `faltan ${eurCents(-diff)}`
      return `Cerró la caja ${str(data.shiftName)} ${str(data.businessDate)} (Z ${str(data.zNumber)}): ${num(data.salesCount)} ventas, ${eurCents(num(data.totalCents))} · ${diffText}`
    }
    case 'cash.movement': {
      const amount = eurCents(num(data.amountCents))
      const extra = [data.document ? `nº ${str(data.document)}` : '', str(data.note)]
        .filter(Boolean)
        .join(' · ')
      const tail = extra ? ` (${extra})` : ''
      if (data.kind === 'supplier_payment')
        return `Pagó ${amount} al proveedor ${str(data.supplier)}${tail}`
      if (data.kind === 'cash_in') return `Metió ${amount} en la caja${tail}`
      if (data.kind === 'cash_out') return `Retiró ${amount} de la caja${tail}`
      return `Movimiento de ${amount}${tail}`
    }
    case 'supplier_invoice.uploaded':
      return `Subió la factura de ${str(data.supplier)} (${eurCents(num(data.amountCents))}${data.document ? ` · nº ${str(data.document)}` : ''}) ${data.via === 'qr' ? 'con el móvil' : 'desde la caja'}: ${str(data.fileName)}`
    case 'auth.login':
      return data.online ? 'Inició sesión (con conexión)' : 'Inició sesión sin conexión'
    case 'auth.logout':
      return 'Cerró sesión'
    case 'auth.login_failed':
      return `Intento de entrada fallido con el usuario «${str(data.username)}»`
    case 'pending_item.completed':
      return `Identificó un producto vendido por precio (${eurCents(num(data.priceCents))}, ticket ${str(data.ticketNumber)}${data.barcode ? `, código ${str(data.barcode)}` : ''})`
    case 'pending_item.dismissed':
      return `Borró de pendientes un producto vendido por precio (${eurCents(num(data.priceCents))}, ticket ${str(data.ticketNumber)}, metido por ${str(data.createdByName)})`
    default:
      return Object.keys(data).length ? JSON.stringify(data) : '—'
  }
}

/**
 * The money an event is about, signed for the till: sales positive, things taken
 * off before paying negative. Null when the event has no amount.
 */
export function eventAmountCents(type: string, data: Data): number | null {
  switch (type) {
    case 'sale.completed':
      return num(data.totalCents)
    case 'ticket.cleared':
    case 'payment.cancelled':
    case 'ticket.parked_discarded':
      return -num(data.totalCents)
    case 'ticket.line_removed':
      return -num(data.quantity) * num(data.priceCents)
    case 'ticket.qty_decreased':
      return -num(data.by) * num(data.priceCents)
    case 'product.manual_added':
      return num(data.quantity) * num(data.priceCents)
    case 'cash_session.closed':
      return num(data.differenceCents)
    case 'cash.movement':
      return data.kind === 'cash_in' ? num(data.amountCents) : -num(data.amountCents)
    default:
      return null
  }
}

/** Escape one CSV cell (semicolon-separated, as Spanish Excel expects). */
export function csvCell(value: unknown): string {
  const text = str(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Patterns worth a look: an unpaid ticket thrown away after the payment screen was
 * opened or cash was typed (charged, kept the money, deleted the sale), a line
 * removed after opening the payment, or a parked ticket discarded.
 */
export function suspicionOf(type: string, data: Data): string | null {
  if (type === 'ticket.cleared' && (data.paymentOpened || num(data.maxTenderedCents) > 0)) {
    return num(data.maxTenderedCents) > 0
      ? 'Borrado después de teclear el efectivo entregado'
      : 'Borrado después de abrir el cobro'
  }
  if (type === 'ticket.line_removed' && data.afterPaymentOpened) {
    return 'Línea quitada después de abrir el cobro'
  }
  if (type === 'payment.cancelled' && num(data.tenderedCents) > 0) {
    return 'Cobro cancelado con efectivo tecleado'
  }
  if (type === 'ticket.parked_discarded') return 'Ticket aparcado descartado sin cobrar'
  return null
}
