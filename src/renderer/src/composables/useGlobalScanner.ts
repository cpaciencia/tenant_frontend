import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBarcodeScanner } from './useBarcodeScanner'
import { useCatalogStore } from '../stores/catalog'
import { usePosStore } from '../stores/pos'
import { useAuthStore } from '../stores/auth'

/**
 * App-wide barcode listener: the reader is always live once a user is logged in,
 * no matter which screen is open (till, backoffice…). A scan adds the product to
 * the ticket and jumps to the till — so "passing a product" always works. A code
 * that isn't in the catalog opens the manual-entry dialog (price now, product data
 * later) and is recorded in the audit log. Mounted once at the app root (never in
 * the customer-display window).
 */
export function useGlobalScanner(): void {
  const catalog = useCatalogStore()
  const pos = usePosStore()
  const auth = useAuthStore()
  const router = useRouter()

  // (Re)load the catalog on every login: a scan resolves instantly from then on,
  // and the best-sellers order is refreshed at each shift change (never mid-shift).
  watch(
    () => auth.isAuthenticated,
    (authed) => {
      if (authed) catalog.load().catch(() => {})
    },
    { immediate: true }
  )

  useBarcodeScanner({
    onScan: (code: string) => {
      if (!auth.isAuthenticated) return
      const product = catalog.findByBarcode(code)
      if (product) {
        pos.addProduct(product.id, product.name, product.priceCents / 100, 'scan')
      } else {
        pos.logEvent('scan.not_found', { barcode: code })
        // Only offer to sell it by price when there is a caja to sell into.
        if (pos.hasSession) pos.openManualEntry(code)
      }
      if (router.currentRoute.value.name !== 'caja') {
        router.push({ name: 'caja' })
      }
    }
  })
}
