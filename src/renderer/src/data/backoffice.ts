/*
 * Sample data for the Backoffice screens (KPIs, recent tickets, payment
 * breakdown and the section metadata). Placeholder data per the README — to be
 * replaced by real reporting queries later. Icons are PrimeIcons.
 */

export interface Kpi {
  label: string
  value: string
  sub: string
  icon: string
  tint: string
  color: string
}

export interface RecentTicket {
  no: string
  hora: string
  method: string
  items: number
  amount: string
  icon: string
  tint: string
  color: string
}

export interface PayBreakdownRow {
  label: string
  amount: string
  pct: string
  icon: string
  color: string
}

export type NavGroupId = 'ventas' | 'compras' | 'catalogo' | 'equipo' | 'sistema'

/** Sidebar groups, in order. A group with a single visible item shows it un-nested. */
export const navGroups: { id: NavGroupId; label: string; icon: string }[] = [
  { id: 'ventas', label: 'Ventas', icon: 'pi-chart-line' },
  { id: 'compras', label: 'Compras', icon: 'pi-truck' },
  { id: 'catalogo', label: 'Catálogo', icon: 'pi-box' },
  { id: 'equipo', label: 'Equipo', icon: 'pi-users' },
  { id: 'sistema', label: 'Sistema', icon: 'pi-cog' }
]

export interface NavItem {
  id: string
  label: string
  icon: string
  group: NavGroupId
  /** Permission(s) that grant access to this section (ANY). Empty = always shown. */
  permissions?: string[]
}

export const navItems: NavItem[] = [
  {
    id: 'ventas',
    label: 'Cajas y cierres',
    icon: 'pi-calculator',
    group: 'ventas',
    permissions: ['sale:read']
  },
  {
    id: 'tickets',
    label: 'Tickets',
    icon: 'pi-receipt',
    group: 'ventas',
    permissions: ['sale:read']
  },
  {
    id: 'actividad',
    label: 'Actividad',
    icon: 'pi-history',
    group: 'ventas',
    permissions: ['activity:read']
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: 'pi-id-card',
    group: 'ventas',
    permissions: ['client:read']
  },
  {
    id: 'proveedores',
    label: 'Proveedores',
    icon: 'pi-truck',
    group: 'compras',
    permissions: ['supplier:manage', 'invoice:read']
  },
  {
    id: 'facturas',
    label: 'Facturas',
    icon: 'pi-file',
    group: 'compras',
    permissions: ['invoice:read']
  },
  {
    id: 'productos',
    label: 'Productos',
    icon: 'pi-box',
    group: 'catalogo',
    permissions: ['product:read']
  },
  {
    id: 'categorias',
    label: 'Categorías',
    icon: 'pi-sitemap',
    group: 'catalogo',
    permissions: ['category:read']
  },
  {
    id: 'cajas',
    label: 'Grupos contables',
    icon: 'pi-wallet',
    group: 'catalogo',
    permissions: ['accounting_group:read']
  },
  {
    id: 'stock',
    label: 'Stock',
    icon: 'pi-server',
    group: 'catalogo',
    permissions: ['stock:read']
  },
  {
    id: 'usuarios',
    label: 'Usuarios',
    icon: 'pi-users',
    group: 'equipo',
    permissions: ['user:read']
  },
  {
    id: 'roles',
    label: 'Roles y permisos',
    icon: 'pi-shield',
    group: 'equipo',
    permissions: ['role:read']
  },
  {
    id: 'puestos',
    label: 'Puestos',
    icon: 'pi-desktop',
    group: 'sistema',
    permissions: ['terminal:manage']
  },
  {
    id: 'configuracion',
    label: 'Configuración',
    icon: 'pi-cog',
    group: 'sistema',
    permissions: ['settings:read']
  }
]

/** Breadcrumb + title per section. */
export const sectionTitles: Record<string, [string, string]> = {
  ventas: ['VENTAS', 'Cajas y cierres'],
  actividad: ['VENTAS', 'Actividad de los TPV'],
  tickets: ['VENTAS', 'Histórico de tickets'],
  facturas: ['COMPRAS', 'Facturas de proveedores'],
  proveedores: ['COMPRAS', 'Proveedores'],
  productos: ['CATÁLOGO', 'Productos'],
  categorias: ['CATÁLOGO', 'Categorías y subcategorías'],
  cajas: ['CATÁLOGO', 'Grupos contables'],
  usuarios: ['EQUIPO', 'Usuarios y empleados'],
  roles: ['EQUIPO', 'Roles y permisos'],
  stock: ['CATÁLOGO', 'Control de stock'],
  clientes: ['VENTAS', 'Clientes y cuentas'],
  puestos: ['SISTEMA', 'Puestos de caja'],
  configuracion: ['SISTEMA', 'Configuración del puesto']
}

export const kpis: Kpi[] = [
  {
    label: 'Ventas de hoy',
    value: '1.247,80 €',
    sub: 'Turno abierto a las 09:00',
    icon: 'pi-euro',
    tint: '#e8f5ec',
    color: '#27ae60'
  },
  {
    label: 'Tickets',
    value: '86',
    sub: 'Ticket medio 14,51 €',
    icon: 'pi-book',
    tint: '#eef5ff',
    color: '#2196F3'
  },
  {
    label: 'Efectivo en caja',
    value: '742,30 €',
    sub: 'Fondo inicial 150,00 €',
    icon: 'pi-money-bill',
    tint: '#fff7ed',
    color: '#FF9800'
  },
  {
    label: 'A cuenta pendiente',
    value: '86,90 €',
    sub: '3 clientes con deuda',
    icon: 'pi-history',
    tint: '#fdeef2',
    color: '#ec407a'
  }
]

export const recentTickets: RecentTicket[] = [
  {
    no: '#0086',
    hora: '13:42',
    method: 'Tarjeta',
    items: 4,
    amount: '18,40 €',
    icon: 'pi-credit-card',
    tint: '#eef5ff',
    color: '#2196F3'
  },
  {
    no: '#0085',
    hora: '13:35',
    method: 'Efectivo',
    items: 2,
    amount: '6,15 €',
    icon: 'pi-money-bill',
    tint: '#e8f5ec',
    color: '#27ae60'
  },
  {
    no: '#0084',
    hora: '13:28',
    method: 'A cuenta',
    items: 7,
    amount: '24,90 €',
    icon: 'pi-book',
    tint: '#fdeef2',
    color: '#ec407a'
  },
  {
    no: '#0083',
    hora: '13:19',
    method: 'Tarjeta',
    items: 3,
    amount: '11,70 €',
    icon: 'pi-credit-card',
    tint: '#eef5ff',
    color: '#2196F3'
  },
  {
    no: '#0082',
    hora: '13:05',
    method: 'Efectivo',
    items: 5,
    amount: '21,30 €',
    icon: 'pi-money-bill',
    tint: '#e8f5ec',
    color: '#27ae60'
  },
  {
    no: '#0081',
    hora: '12:58',
    method: 'Efectivo',
    items: 1,
    amount: '1,20 €',
    icon: 'pi-money-bill',
    tint: '#e8f5ec',
    color: '#27ae60'
  }
]

export const payBreakdown: PayBreakdownRow[] = [
  { label: 'Efectivo', amount: '742,30 €', pct: '60%', icon: 'pi-money-bill', color: '#27ae60' },
  { label: 'Tarjeta', amount: '418,60 €', pct: '33%', icon: 'pi-credit-card', color: '#2196F3' },
  { label: 'A cuenta', amount: '86,90 €', pct: '7%', icon: 'pi-book', color: '#ec407a' }
]
