import '@renderer/assets/styles.css'
import 'primeicons/primeicons.css'

// Bundled fonts (same as the desktop app, kept consistent across both targets).
import '@fontsource/lato/300.css'
import '@fontsource/lato/400.css'
import '@fontsource/lato/700.css'
import '@fontsource/lato/900.css'
import '@fontsource/playfair-display/700.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import App from './App.vue'
import { router } from './router'
import { installWebPlatformShim } from './platform-shim'
import { configureHttp } from '@renderer/services/http'
import { setAuthProvider, useAuthStore } from '@renderer/stores/auth'
import { createHttpAuthProvider } from '@renderer/services/auth/httpProvider'
import { vCan } from '@renderer/directives/can'

// Must run before any shared component mounts (some read window.api).
installWebPlatformShim()

const app = createApp(App)

app.use(createPinia())

// Online auth: talk to the cloud backend with a Bearer token from the store.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
configureHttp({ baseUrl: API_URL, getToken: () => useAuthStore().token })
setAuthProvider(createHttpAuthProvider())
app.directive('can', vCan)

app.use(router)

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.app-dark',
      cssLayer: {
        name: 'primevue',
        order: 'theme, base, primevue'
      }
    }
  }
})

app.mount('#app')