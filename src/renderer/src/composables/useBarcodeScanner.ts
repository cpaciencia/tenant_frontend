import { onBeforeUnmount, onMounted } from 'vue'
import { createBarcodeMatcher, type BarcodeMatcherOptions } from './barcodeMatcher'

export interface UseBarcodeScannerOptions extends BarcodeMatcherOptions {
  onScan: (code: string) => void
}

/**
 * Listens globally for barcode scans (keyboard-wedge). No focused input needed:
 * a completed scan calls `onScan` and the triggering Enter is swallowed so it
 * doesn't submit a form. Attaches on mount, detaches on unmount.
 */
export function useBarcodeScanner(options: UseBarcodeScannerOptions): void {
  const matcher = createBarcodeMatcher(options)

  const handler = (event: KeyboardEvent): void => {
    const code = matcher.push(event.key, event.timeStamp)
    if (code) {
      event.preventDefault()
      options.onScan(code)
    }
  }

  onMounted(() => window.addEventListener('keydown', handler))
  onBeforeUnmount(() => window.removeEventListener('keydown', handler))
}
