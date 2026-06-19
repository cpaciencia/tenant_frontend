<script setup lang="ts">
import { clients, eur, initials } from '../../data/catalog'
</script>

<template>
  <div class="bo-card">
    <div class="cli__head">
      <div class="cli__title">Clientes con cuenta</div>
      <div class="cli__spacer"></div>
      <button class="bo-add-btn"><i class="pi pi-user-plus"></i> Nuevo cliente</button>
    </div>
    <div v-for="c in clients" :key="c.id" class="cli__row">
      <div class="cli__avatar">{{ initials(c.name) }}</div>
      <div class="cli__info">
        <div class="cli__name">{{ c.name }}</div>
        <div class="cli__detail">{{ c.detail }}</div>
      </div>
      <div class="cli__saldo-wrap">
        <div class="cli__saldo-label">SALDO PENDIENTE</div>
        <div
          class="cli__saldo pos-money"
          :style="{ color: c.saldo > 0 ? 'var(--pos-danger)' : 'var(--pos-text-3)' }"
        >
          {{ c.saldo > 0 ? eur(c.saldo) : '0,00 €' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cli__head {
  display: flex;
  align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--pos-border-subtle);
}
.cli__title {
  font-size: 16px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.cli__spacer {
  flex: 1;
}
.cli__row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px 22px;
  border-bottom: 1px solid #f4f7f9;
}
.cli__avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--pos-green-soft);
  color: var(--pos-green-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 15px;
}
.cli__info {
  flex: 1;
}
.cli__name {
  font-size: 15px;
  font-weight: 800;
  color: var(--pos-text);
}
.cli__detail {
  font-size: 13px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.cli__saldo-wrap {
  text-align: right;
}
.cli__saldo-label {
  font-size: 11px;
  color: var(--pos-text-3);
  font-weight: 700;
  letter-spacing: 0.03em;
}
.cli__saldo {
  font-size: 18px;
}
</style>
