import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Components from 'unplugin-vue-components/vite'
import { PrimeVueResolver } from '@primevue/auto-import-resolver'

export default defineConfig({
  // externalizeDepsPlugin keeps node_modules deps (esp. the native better-sqlite3)
  // out of the bundle so they're require()d at runtime from node_modules.
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      vue(),
      tailwindcss(),
      Components({
        dts: resolve('src/renderer/components.d.ts'),
        resolvers: [PrimeVueResolver()]
      })
    ]
  }
})
