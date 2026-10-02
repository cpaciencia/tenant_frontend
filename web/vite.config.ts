import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Components from 'unplugin-vue-components/vite'
import { PrimeVueResolver } from '@primevue/auto-import-resolver'

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

/**
 * Standalone web build of the Backoffice. It reuses the SAME Vue components that
 * the Electron renderer ships (aliased as `@renderer`), so management screens are
 * authored once and run both as the desktop app and in the browser. The desktop
 * app talks to local SQLite over IPC; the web build talks to the cloud backend
 * over HTTP — only the data layer differs, never the UI.
 */
export default defineConfig({
  root: r('.'),
  resolve: {
    alias: {
      '@renderer': r('../src/renderer/src')
    }
  },
  plugins: [
    vue(),
    tailwindcss(),
    Components({
      dts: r('./components.d.ts'),
      resolvers: [PrimeVueResolver()]
    })
  ],
  server: {
    port: 5050,
    strictPort: true
  },
  build: {
    outDir: r('../out-web'),
    emptyOutDir: true
  }
})
