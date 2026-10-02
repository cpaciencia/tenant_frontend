<script setup lang="ts">
import { useRouter } from 'vue-router'
import EnrollForm from '../components/setup/EnrollForm.vue'
import logoUrl from '../assets/img/logo.png'
import heroUrl from '../assets/img/hero-aerial.jpg'

/**
 * First-run screen shown before login while the terminal isn't enrolled. The
 * router guard forces every navigation here until enrolment succeeds; on success
 * we move on to the login.
 */
const router = useRouter()

function onEnrolled(): void {
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="setup">
    <div class="setup__brand">
      <img :src="heroUrl" class="setup__hero" alt="" />
      <div class="setup__overlay"></div>
      <div class="setup__brand-content">
        <img :src="logoUrl" class="setup__logo" alt="Parque Tropical" />
        <div>
          <div class="setup__title">Configuración inicial</div>
          <div class="setup__subtitle">
            Conecta este puesto con el servidor y enrólalo para empezar. Solo se hace una vez.
          </div>
        </div>
        <div class="setup__steps">
          <div><b>1.</b> Indica la URL del backend y prueba la conexión.</div>
          <div><b>2.</b> Escribe el número de puesto y el código que te dio el administrador.</div>
          <div><b>3.</b> Enrola: el puesto recibe sus credenciales y queda listo.</div>
        </div>
      </div>
    </div>

    <div class="setup__form-wrap">
      <div class="setup__form">
        <div class="setup__heading">Enrolar terminal</div>
        <div class="setup__lead">Este equipo aún no está enrolado.</div>
        <EnrollForm @enrolled="onEnrolled" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
}
.setup__brand {
  position: relative;
  background: var(--pos-green-dark);
  overflow: hidden;
}
.setup__hero {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.6;
}
.setup__overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(12, 33, 21, 0.9) 0%, rgba(33, 154, 82, 0.45) 100%);
}
.setup__brand-content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 52px;
  color: #fff;
}
.setup__logo {
  width: 112px;
  height: 112px;
  object-fit: contain;
  background: #fff;
  border-radius: 50%;
  padding: 14px;
}
.setup__title {
  font-family: var(--font-brand);
  font-size: 46px;
  font-weight: 700;
  line-height: 1.05;
}
.setup__subtitle {
  font-size: 18px;
  opacity: 0.88;
  margin-top: 14px;
  max-width: 420px;
  line-height: 1.5;
}
.setup__steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  opacity: 0.85;
  line-height: 1.4;
}
.setup__form-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f4f7f9;
  padding: 40px;
}
.setup__form {
  width: 100%;
  max-width: 400px;
}
.setup__heading {
  font-size: 28px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.setup__lead {
  color: #6b7280;
  margin: 8px 0 18px;
  font-size: 15px;
}
</style>
