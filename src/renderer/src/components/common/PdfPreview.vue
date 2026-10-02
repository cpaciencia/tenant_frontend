<script setup lang="ts">
/**
 * Renders a PDF (the bytes of e.g. a downloaded invoice) page by page onto
 * canvases with pdf.js. Used instead of an <iframe>: Electron's built-in PDF
 * viewer doesn't paint inside an app window, and this works the same on web.
 * The bytes are handed over directly (no fetch of a blob: URL) and the worker is
 * served from our own bundle — fits the strict CSP.
 */
import { onMounted, onUnmounted, ref } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps<{ file: Blob }>()

const host = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const error = ref('')
let task: pdfjs.PDFDocumentLoadingTask | null = null

onMounted(async () => {
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(await props.file.arrayBuffer()) })
    const doc = await task.promise
    const width = host.value?.clientWidth ?? 800
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const ratio = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: (width / base.width) * ratio })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / ratio}px`
      canvas.className = 'pdf-page'
      host.value?.appendChild(canvas)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas no disponible')
      await page.render({ canvasContext: ctx, viewport }).promise
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo mostrar el PDF.'
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  void task?.destroy()
})
</script>

<template>
  <div class="pdf">
    <div v-if="loading" class="pdf-msg"><i class="pi pi-spin pi-spinner"></i> Cargando PDF…</div>
    <div v-if="error" class="pdf-msg pdf-msg--error">
      No se pudo mostrar el PDF ({{ error }}). Usa «Descargar».
    </div>
    <div ref="host" class="pdf-pages"></div>
  </div>
</template>

<style scoped>
.pdf {
  max-height: 70vh;
  overflow-y: auto;
  background: #e5e7eb;
  border-radius: 8px;
  padding: 10px;
}
.pdf-pages {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}
.pdf-pages :deep(.pdf-page) {
  max-width: 100%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.pdf-msg {
  padding: 12px;
  font-weight: 700;
  color: var(--pos-text-2);
}
.pdf-msg--error {
  color: var(--pos-danger);
}
</style>
