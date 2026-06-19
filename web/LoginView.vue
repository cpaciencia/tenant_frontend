<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@renderer/stores/auth'
import logoUrl from '@renderer/assets/img/logo.png'

const auth = useAuthStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit(): Promise<void> {
  if (!username.value.trim() || !password.value.trim()) {
    error.value = 'Introduce usuario y contraseña'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await auth.login(username.value.trim(), password.value)
    router.push({ path: '/' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo iniciar sesión'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <form class="login__card" @submit.prevent="submit">
      <img :src="logoUrl" class="login__logo" alt="Parque Tropical" />
      <div class="login__title">Backoffice</div>
      <div class="login__sub">Camping Parque Tropical</div>

      <label class="login__label">USUARIO</label>
      <InputText v-model="username" autocomplete="username" fluid />

      <label class="login__label">CONTRASEÑA</label>
      <Password
        v-model="password"
        :feedback="false"
        toggle-mask
        fluid
        input-class="w-full"
        @keyup.enter="submit"
      />

      <span v-if="error" class="login__error">{{ error }}</span>

      <Button type="submit" label="Entrar" :loading="loading" class="login__btn" />
    </form>
  </div>
</template>

<style scoped>
.login {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pos-green-dark);
}
.login__card {
  width: 360px;
  background: #fff;
  border-radius: 18px;
  padding: 36px 32px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
}
.login__logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
  align-self: center;
}
.login__title {
  font-size: 24px;
  font-weight: 900;
  color: var(--pos-green-dark);
  text-align: center;
}
.login__sub {
  font-size: 13px;
  color: var(--pos-text-3);
  text-align: center;
  margin-bottom: 12px;
}
.login__label {
  font-weight: 700;
  font-size: 12px;
  margin-top: 10px;
  color: var(--pos-green-dark);
}
.login__error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
  margin-top: 6px;
}
.login__btn {
  margin-top: 18px;
}
</style>
