import './assets/styles.css'
import 'primeicons/primeicons.css'

// Bundled fonts (CSP forbids CDNs): Lato for the UI, Playfair Display for the
// brand title on the login screen.
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
import { configureHttp } from './services/http'
import { setAuthProvider, useAuthStore } from './stores/auth'
import { createIpcAuthProvider } from './services/auth/ipcProvider'
import { vCan } from './directives/can'

const app = createApp(App)

app.use(createPinia())

// Auth: offline-first via the Main process (IPC). When online, login also returns
// a JWT used to reach the cloud backend for management screens (same as web).
setAuthProvider(createIpcAuthProvider())
app.directive('can', vCan)
// Point the HTTP client at this terminal's backend (for online management calls).
window.api.enrollment
  .getState()
  .then((state) =>
    configureHttp({ baseUrl: state.syncApiUrl, getToken: () => useAuthStore().token })
  )
  .catch(() => configureHttp({ baseUrl: '', getToken: () => useAuthStore().token }))

app.use(router)

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      // Toggle dark mode by adding/removing `.app-dark` on <html>.
      darkModeSelector: '.app-dark',
      // Keep PrimeVue styles in their own layer so Tailwind utilities can override them.
      cssLayer: {
        name: 'primevue',
        order: 'theme, base, primevue'
      }
    }
  }
})

app.mount('#app')
