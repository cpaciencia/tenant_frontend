<script setup lang="ts">
/**
 * Printable receipt (Mercadona-style). Pure presentation: it renders the "paper".
 * The parent decides where to show it and provides a Print/Close UI. Amounts are
 * in cents. No VAT breakdown — products don't carry tax rates yet.
 */
interface ReceiptLine {
  name: string
  quantity: number
  unitPriceCents: number
  lineCents: number
}

defineProps<{
  business: { name: string; address: string; taxId: string; phone: string }
  ticketNumber: string
  dateIso: string
  lines: ReceiptLine[]
  totalCents: number
  payment: { cashCents: number; cardCents: number; creditCents: number }
  changeCents?: number
}>()

function eur(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })
}
</script>

<template>
  <div class="receipt">
    <div class="receipt__head">
      <div class="receipt__name">{{ business.name || 'TICKET' }}</div>
      <div v-if="business.address" class="receipt__sub">{{ business.address }}</div>
      <div v-if="business.taxId" class="receipt__sub">CIF: {{ business.taxId }}</div>
      <div v-if="business.phone" class="receipt__sub">Tel: {{ business.phone }}</div>
    </div>

    <div class="receipt__rule"></div>
    <div class="receipt__meta">
      <span>{{ ticketNumber }}</span>
      <span>{{ fmtDate(dateIso) }}</span>
    </div>
    <div class="receipt__rule"></div>

    <div class="receipt__lines">
      <div v-for="(l, i) in lines" :key="i" class="receipt__line">
        <div class="receipt__line-row">
          <span class="receipt__qty">{{ l.quantity }}</span>
          <span class="receipt__desc">{{ l.name }}</span>
          <span class="receipt__amt">{{ eur(l.lineCents) }}</span>
        </div>
        <div v-if="l.quantity > 1" class="receipt__unit">
          {{ l.quantity }} × {{ eur(l.unitPriceCents) }}
        </div>
      </div>
    </div>

    <div class="receipt__rule"></div>
    <div class="receipt__total">
      <span>TOTAL</span>
      <span>{{ eur(totalCents) }} €</span>
    </div>
    <div class="receipt__rule"></div>

    <div class="receipt__pay">
      <div v-if="payment.cashCents !== 0" class="receipt__pay-row">
        <span>Efectivo</span><span>{{ eur(payment.cashCents) }} €</span>
      </div>
      <div v-if="payment.cardCents !== 0" class="receipt__pay-row">
        <span>Tarjeta</span><span>{{ eur(payment.cardCents) }} €</span>
      </div>
      <div v-if="payment.creditCents !== 0" class="receipt__pay-row">
        <span>A cuenta</span><span>{{ eur(payment.creditCents) }} €</span>
      </div>
      <div v-if="changeCents && changeCents > 0" class="receipt__pay-row receipt__pay-row--change">
        <span>Cambio</span><span>{{ eur(changeCents) }} €</span>
      </div>
    </div>

    <div class="receipt__foot">¡Gracias por su visita!</div>
  </div>
</template>

<style scoped>
.receipt {
  width: 300px;
  background: #fff;
  color: #000;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.45;
  padding: 16px 18px;
}
.receipt__head {
  text-align: center;
}
.receipt__name {
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.04em;
}
.receipt__sub {
  font-size: 11px;
}
.receipt__rule {
  border-top: 1px dashed #000;
  margin: 8px 0;
}
.receipt__meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.receipt__line-row {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  gap: 6px;
}
.receipt__qty {
  text-align: right;
}
.receipt__desc {
  word-break: break-word;
}
.receipt__amt {
  text-align: right;
}
.receipt__unit {
  padding-left: 28px;
  font-size: 10px;
  color: #333;
}
.receipt__total {
  display: flex;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 900;
}
.receipt__pay-row {
  display: flex;
  justify-content: space-between;
}
.receipt__pay-row--change {
  font-weight: 700;
}
.receipt__foot {
  text-align: center;
  margin-top: 12px;
  font-size: 11px;
}
</style>
