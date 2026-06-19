import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBarcodeScanner } from './useBarcodeScanner'
import { useCatalogStore } from '../stores/catalog'
import { usePosStore } from '../stores/pos'
import { useAuthStore } from '../stores/auth'

/**
 * App-wide barcode listener: the reader is always live once a user is logged in,
 * no matter which screen is open (till, backoffice…). A scan adds the product to
 * the ticket and jumps to the till — so "passing a product" always works. Mounted
 * once at the app root (never in the customer-display window).
 */
export function useGlobalScanner(): void {
  const catalog = useCatalogStore()
  const pos = usePosStore()
  const auth = useAuthStore()
  const router = useRouter()

  // Keep the catalog loaded so a scan resolves instantly, from login onward.
  watch(
    () => auth.isAuthenticated,
    (authed) => {
      if (authed && !catalog.loaded) catalog.load().catch(() => {})
    },
    { immediate: true }
  )

  useBarcodeScanner({
    onScan: (code: string) => {
      if (!auth.isAuthenticated) return
      const product = catalog.findByBarcode(code)
      if (!product) return
      pos.addProduct(product.id, product.name, product.priceCents / 100)
      if (router.currentRoute.value.name !== 'caja') {
        router.push({ name: 'caja' })
      }
    }
  })
}
