import type { DB } from './connection'
import { countProducts, upsertProducts } from '../repositories/products'

/**
 * Dev-only sample catalog so the renderer has products to work with before the
 * real legacy-catalog import lands. No-op once any product exists. Names are
 * domain content (Spanish), not code.
 */
export function seedDevProducts(db: DB): void {
  if (countProducts(db) > 0) return
  upsertProducts(db, [
    { barcode: '8412345000017', name: 'Agua mineral 1.5L', priceCents: 90, taxRate: 0.1 },
    { barcode: '8412345000024', name: 'Barra de hielo 2kg', priceCents: 250, taxRate: 0.21 },
    { barcode: '8412345000031', name: 'Cartucho gas camping 190g', priceCents: 450, taxRate: 0.21 },
    { barcode: null, name: 'Venta varios', priceCents: 100, taxRate: 0.21 }
  ])
}
