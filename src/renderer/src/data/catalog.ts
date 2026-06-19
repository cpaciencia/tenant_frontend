/*
 * Sample data for the POS UI, ported from the design prototype. The README is
 * explicit that this is placeholder data: the catalog, clients, users and stock
 * are meant to be swapped for the real data layer (SQLite via the IPC bridge)
 * later. Keeping it isolated here marks the seam.
 *
 * Icons are PrimeIcons class names (the project ships primeicons), mapped from
 * the Font Awesome icons used in the prototype — colour carries the category
 * identity, the glyph is an approximation.
 */

export interface Category {
  id: string
  name: string
  /** PrimeIcons class, e.g. `pi-bolt`. */
  icon: string
  /** Accent colour used for the tile bar, chips and table dots. */
  color: string
}

export interface CatalogProduct {
  name: string
  /** Price in euros (sample data uses euros, not cents). */
  price: number
}

export interface Client {
  id: string
  name: string
  detail: string
  /** Outstanding "fiado" (tab) balance in euros. */
  saldo: number
}

export interface User {
  name: string
  role: string
  status: string
  active: boolean
}

export interface StockItem {
  name: string
  stock: number
  min: number
  categoryId: string
}

export const categories: Category[] = [
  { id: 'bebidas', name: 'Bebidas', icon: 'pi-bolt', color: '#2196F3' },
  { id: 'cervezas', name: 'Cervezas y Vinos', icon: 'pi-star', color: '#9C27B0' },
  { id: 'snacks', name: 'Aperitivos', icon: 'pi-gift', color: '#FF9800' },
  { id: 'lacteos', name: 'Lácteos', icon: 'pi-box', color: '#00BCD4' },
  { id: 'panaderia', name: 'Panadería', icon: 'pi-bookmark', color: '#e0a800' },
  { id: 'fruta', name: 'Fruta y Verdura', icon: 'pi-sun', color: '#4CAF50' },
  { id: 'conservas', name: 'Conservas', icon: 'pi-inbox', color: '#8d6e63' },
  { id: 'limpieza', name: 'Limpieza', icon: 'pi-sparkles', color: '#00897b' },
  { id: 'higiene', name: 'Higiene', icon: 'pi-heart', color: '#ec407a' },
  { id: 'camping', name: 'Camping', icon: 'pi-flag', color: '#5d6d7e' }
]

export const catalog: Record<string, CatalogProduct[]> = {
  bebidas: [
    { name: 'Agua 0,5L', price: 0.6 },
    { name: 'Agua 1,5L', price: 0.95 },
    { name: 'Coca-Cola lata', price: 1.2 },
    { name: 'Fanta lata', price: 1.2 },
    { name: 'Nestea', price: 1.4 },
    { name: 'Aquarius', price: 1.5 },
    { name: 'Zumo Naranja', price: 1.8 },
    { name: 'Red Bull', price: 1.95 },
    { name: 'Café lata', price: 1.3 },
    { name: 'Tónica', price: 1.1 }
  ],
  cervezas: [
    { name: 'Cruzcampo lata', price: 0.95 },
    { name: 'Mahou 5 Estrellas', price: 1.1 },
    { name: 'Estrella Galicia', price: 1.15 },
    { name: 'Heineken', price: 1.25 },
    { name: 'Alhambra 1925', price: 1.6 },
    { name: 'Vino Tinto bot.', price: 4.5 },
    { name: 'Vino Blanco bot.', price: 4.2 },
    { name: 'Tinto de Verano', price: 1.4 },
    { name: 'Sidra', price: 2.3 },
    { name: 'Cerveza 0,0', price: 1.0 }
  ],
  snacks: [
    { name: 'Patatas Lays', price: 1.75 },
    { name: 'Doritos', price: 1.95 },
    { name: 'Pringles', price: 2.6 },
    { name: 'Frutos Secos', price: 2.2 },
    { name: 'Aceitunas', price: 1.3 },
    { name: 'Galletas María', price: 1.1 },
    { name: 'Chocolatina', price: 0.9 },
    { name: 'Chicles', price: 0.8 },
    { name: 'Palomitas', price: 1.5 },
    { name: 'Tortitas', price: 1.6 }
  ],
  lacteos: [
    { name: 'Leche 1L', price: 0.98 },
    { name: 'Yogur Natural x4', price: 1.45 },
    { name: 'Yogur Griego', price: 1.8 },
    { name: 'Queso lonchas', price: 2.4 },
    { name: 'Mantequilla', price: 1.9 },
    { name: 'Nata', price: 1.6 },
    { name: 'Flan x4', price: 1.75 },
    { name: 'Actimel x6', price: 2.95 },
    { name: 'Batido Choco', price: 1.2 },
    { name: 'Queso fresco', price: 2.1 }
  ],
  panaderia: [
    { name: 'Barra de pan', price: 0.7 },
    { name: 'Pan de molde', price: 1.4 },
    { name: 'Croissant', price: 0.95 },
    { name: 'Magdalenas', price: 1.8 },
    { name: 'Donuts x4', price: 2.2 },
    { name: 'Bollería surtida', price: 2.5 },
    { name: 'Pan integral', price: 1.6 },
    { name: 'Tostadas', price: 1.75 },
    { name: 'Bizcocho', price: 3.2 },
    { name: 'Ensaimada', price: 1.9 }
  ],
  fruta: [
    { name: 'Plátanos kg', price: 1.75 },
    { name: 'Manzanas kg', price: 1.95 },
    { name: 'Naranjas kg', price: 1.4 },
    { name: 'Tomates kg', price: 2.1 },
    { name: 'Lechuga ud', price: 0.95 },
    { name: 'Limones kg', price: 1.8 },
    { name: 'Fresas tarrina', price: 2.9 },
    { name: 'Sandía kg', price: 0.85 },
    { name: 'Aguacate ud', price: 1.2 },
    { name: 'Cebolla kg', price: 1.3 }
  ],
  conservas: [
    { name: 'Atún pack 3', price: 2.8 },
    { name: 'Sardinas lata', price: 1.5 },
    { name: 'Tomate frito', price: 0.95 },
    { name: 'Maíz bote', price: 1.2 },
    { name: 'Garbanzos', price: 0.9 },
    { name: 'Aceitunas bote', price: 1.75 },
    { name: 'Mejillones', price: 2.4 },
    { name: 'Paté', price: 1.3 },
    { name: 'Espárragos', price: 2.95 },
    { name: 'Berberechos', price: 3.5 }
  ],
  limpieza: [
    { name: 'Papel higiénico x4', price: 2.4 },
    { name: 'Servilletas', price: 1.1 },
    { name: 'Rollo cocina', price: 1.6 },
    { name: 'Lavavajillas', price: 1.95 },
    { name: 'Detergente', price: 3.9 },
    { name: 'Bolsas basura', price: 1.8 },
    { name: 'Estropajo', price: 1.2 },
    { name: 'Lejía', price: 1.4 },
    { name: 'Toallitas', price: 2.1 },
    { name: 'Friegasuelos', price: 2.6 }
  ],
  higiene: [
    { name: 'Gel de ducha', price: 2.3 },
    { name: 'Champú', price: 2.8 },
    { name: 'Pasta dientes', price: 1.95 },
    { name: 'Cepillo dientes', price: 1.5 },
    { name: 'Desodorante', price: 2.6 },
    { name: 'Protector solar', price: 8.9 },
    { name: 'Maquinilla afeitar', price: 2.2 },
    { name: 'Compresas', price: 2.4 },
    { name: 'Pañuelos', price: 1.1 },
    { name: 'Tiritas', price: 1.8 }
  ],
  camping: [
    { name: 'Bombona gas peq.', price: 4.5 },
    { name: 'Hielo 2kg', price: 1.9 },
    { name: 'Pastillas BBQ', price: 2.3 },
    { name: 'Repelente insectos', price: 5.6 },
    { name: 'Pilas AA x4', price: 3.2 },
    { name: 'Mechero', price: 1.1 },
    { name: 'Cerillas', price: 0.8 },
    { name: 'Vasos plást. x25', price: 1.5 },
    { name: 'Platos plást. x25', price: 1.8 },
    { name: 'Linterna', price: 6.9 }
  ]
}

export const clients: Client[] = [
  { id: 'c1', name: 'Familia Müller', detail: 'Parcela 14 · Estancia larga', saldo: 42.8 },
  { id: 'c2', name: 'Jean Dupont', detail: 'Bungalow Confort 3', saldo: 18.5 },
  { id: 'c3', name: 'Rossi Marco', detail: 'Parcela 31', saldo: 0 },
  { id: 'c4', name: 'García López', detail: 'Kampaoh 7', saldo: 25.6 },
  { id: 'c5', name: 'The Smiths', detail: 'Parcela 8 · Caravana', saldo: 0 }
]

export const users: User[] = [
  { name: 'María Cajera', role: 'Cajero/a', status: 'Activo', active: true },
  { name: 'Antonio Ruiz', role: 'Encargado', status: 'Activo', active: true },
  { name: 'Laura Gómez', role: 'Recepción', status: 'Activo', active: true },
  { name: 'Pedro Sanz', role: 'Administrador', status: 'Inactivo', active: false }
]

export const stock: StockItem[] = [
  { name: 'Agua 1,5L', stock: 8, min: 20, categoryId: 'bebidas' },
  { name: 'Coca-Cola lata', stock: 64, min: 24, categoryId: 'bebidas' },
  { name: 'Cruzcampo lata', stock: 120, min: 48, categoryId: 'cervezas' },
  { name: 'Patatas Lays', stock: 5, min: 12, categoryId: 'snacks' },
  { name: 'Leche 1L', stock: 38, min: 20, categoryId: 'lacteos' },
  { name: 'Barra de pan', stock: 0, min: 10, categoryId: 'panaderia' },
  { name: 'Hielo 2kg', stock: 14, min: 15, categoryId: 'camping' },
  { name: 'Protector solar', stock: 22, min: 8, categoryId: 'higiene' },
  { name: 'Papel higiénico x4', stock: 31, min: 12, categoryId: 'limpieza' }
]

export function categoryColor(id: string): string {
  return categories.find((c) => c.id === id)?.color ?? '#27ae60'
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function eur(n: number): string {
  return (
    (n || 0).toLocaleString('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' €'
  )
}
