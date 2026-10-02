import type { DB } from '../db/connection'

/**
 * Units sold per catalog product on this terminal (all its completed sales),
 * used to show the best sellers first in the POS grid. Read from the sale lines
 * stored as JSON; manual lines (no product) are ignored.
 */
export function unitsSoldByProduct(db: DB): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT json_extract(line.value, '$.productId') AS productId,
              SUM(json_extract(line.value, '$.quantity')) AS units
         FROM sales, json_each(sales.items_json) AS line
        WHERE sales.status = 'completed'
          AND json_extract(line.value, '$.productId') IS NOT NULL
        GROUP BY productId`
    )
    .all() as { productId: string; units: number }[]
  return Object.fromEntries(rows.map((r) => [r.productId, r.units]))
}
