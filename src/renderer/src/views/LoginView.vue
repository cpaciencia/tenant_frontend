<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { usePosStore } from '../stores/pos'
import EnrollForm from '../components/setup/EnrollForm.vue'
import logoUrl from '../assets/img/logo.png'
import heroUrl from '../assets/img/hero-aerial.jpg'

const auth = useAuthStore()
const pos = usePosStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// Terminal settings (backend URL / re-enrolment) reachable before login.
const configOpen = ref(false)

async function doLogin(): Promise<void> {
  if (!username.value.trim() || !password.value.trim()) {
    error.value = 'Introduce usuario y contraseña'
    return
  }
  error.value = ''
  loading.value = true
  try {
    // Real auth: offline-first against the local mirror (online when reachable).
    await auth.login(username.value.trim(), password.value)
    // Mirror the cashier identity into the POS store for the till's top bar.
    const u = auth.user
    pos.login({ name: u?.fullName || u?.username || 'Cajero', role: u?.role ?? '' })
    router.push({ name: 'caja' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo iniciar sesión'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <!-- Brand panel -->
    <div class="login__brand">
      <img :src="heroUrl" class="login__hero" alt="" />
      <div class="login__overlay"></div>
      <div class="login__brand-content">
        <img :src="logoUrl" class="login__logo" alt="Parque Tropical" />
        <div>
          <div class="login__title">Punto de Venta</div>
          <div class="login__subtitle">
            Camping Parque Tropical · Mini-market y servicios de la Costa del Sol
          </div>
        </div>
        <div class="login__version">VERSIÓN 2.0 · TERMINAL CAJA 01</div>
      </div>
    </div>

    <!-- Form panel -->
    <div class="login__form-wrap">
      <button class="login__gear" title="Ajustes del terminal" @click="configOpen = true">
        <i class="pi pi-cog"></i>
      </button>
      <div class="login__form">
        <div class="login__heading">Iniciar sesión</div>
        <div class="login__lead">Introduce tus credenciales para abrir la caja.</div>

        <label class="login__label">USUARIO</label>
        <div class="login__field">
          <i class="pi pi-user login__field-icon"></i>
          <input
            v-model="username"
            class="login__input"
            placeholder="Nombre de usuario"
            @keydown.enter="doLogin"
          />
        </div>

        <label class="login__label">CONTRASEÑA</label>
        <div class="login__field login__field--tight">
          <i class="pi pi-lock login__field-icon"></i>
          <input
            v-model="password"
            type="password"
            class="login__input"
            placeholder="••••••"
            @keydown.enter="doLogin"
          />
        </div>

        <div v-if="error" class="login__error">
          <i class="pi pi-exclamation-circle"></i> {{ error }}
        </div>

        <button class="login__submit" @click="doLogin">ENTRAR</button>
        <div class="login__hint">Acceso demo · pulsa <b>Entrar</b></div>
      </div>
    </div>

    <Dialog
      v-model:visible="configOpen"
      modal
      header="Ajustes del terminal"
      :style="{ width: '440px' }"
    >
      <EnrollForm />
    </Dialog>
  </div>
</template>

<style scoped>
.login {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
}

.login__brand {
  position: relative;
  background: var(--pos-green-dark);
  overflow: hidden;
}
.login__hero {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.6;
}
.login__overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(12, 33, 21, 0.9) 0%, rgba(33, 154, 82, 0.45) 100%);
}
.login__brand-content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 52px;
  color: #fff;
}
.login__logo {
  width: 128px;
  height: 128px;
  object-fit: contain;
  background: #fff;
  border-radius: 50%;
  padding: 14px;
}
.login__title {
  font-family: var(--font-brand);
  font-size: 52px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.01em;
}
.login__subtitle {
  font-size: 19px;
  opacity: 0.88;
  margin-top: 14px;
  max-width: 400px;
  line-height: 1.5;
}
.login__version {
  font-size: 13px;
  opacity: 0.65;
  letter-spacing: 0.04em;
}

.login__form-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f4f7f9;
  padding: 40px;
}
.login__gear {
  position: absolute;
  top: 22px;
  right: 22px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  background: #fff;
  border: 1.5px solid #e2e8ee;
  transition:
    color 0.12s ease,
    border-color 0.12s ease;
}
.login__gear:hover {
  color: var(--pos-green);
  border-color: var(--pos-green);
}
.login__form {
  width: 100%;
  max-width: 380px;
}
.login__heading {
  font-size: 28px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.login__lead {
  color: #6b7280;
  margin: 8px 0 32px;
  font-size: 15px;
}
.login__label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #374151;
  letter-spacing: 0.02em;
  margin-bottom: 8px;
}
.login__field {
  position: relative;
  margin-bottom: 20px;
}
.login__field--tight {
  margin-bottom: 10px;
}
.login__field-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  font-size: 15px;
}
.login__input {
  width: 100%;
  height: 54px;
  padding: 0 16px 0 44px;
  font-size: 16px;
  border: 1.5px solid #d6dce2;
  border-radius: 10px;
  background: #fff;
  outline: none;
  color: var(--pos-text);
}
.login__input:focus {
  border-color: var(--pos-green);
}
.login__error {
  color: var(--pos-danger);
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}
.login__submit {
  width: 100%;
  height: 56px;
  margin-top: 14px;
  background: var(--pos-green);
  color: #fff;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0.06em;
  border-radius: 10px;
  box-shadow: var(--pos-shadow-cobrar);
  transition: background 0.12s ease;
}
.login__submit:hover {
  background: var(--pos-green-hover);
}
.login__hint {
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  margin-top: 18px;
}
.login__hint b {
  color: #6b7280;
}
</style>
