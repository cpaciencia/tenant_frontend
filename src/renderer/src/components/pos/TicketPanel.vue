<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'

const store = usePosStore()
const { ticket, selectedKey, isEmpty, lineCount, base, iva, total, lastSale, parkedCount } =
  storeToRefs(store)
const emit = defineEmits<{ (e: 'open-parked'): void }>()

async function park(): Promise<void> {
  try {
    await store.parkCurrent()
  } catch {
    /* the ticket stays in place if parking fails */
  }
}
// The number of THIS ticket is only allocated when it is paid (createSale(), inside
// the sale transaction), so the header shows the last one actually issued.
</script>

<template>
  <section class="ticket">
    <div class="ticket__head">
      <div>
        <div class="ticket__title">Ticket</div>
        <div class="ticket__sub">
          {{ lineCount }} art.<template v-if="lastSale">
            · último: {{ lastSale.ticketNumber }}</template
          >
        </div>
      </div>
      <div class="ticket__actions">
        <button
          v-if="parkedCount > 0"
          class="ticket__btn ticket__btn--parked"
          title="Tickets aparcados: pulsa para recuperar uno"
          @click="emit('open-parked')"
        >
          <i class="pi pi-inbox"></i> Aparcados <b>{{ parkedCount }}</b>
        </button>
        <button
          class="ticket__btn"
          :disabled="isEmpty"
          title="Apartar este ticket para cobrar a otro cliente y recuperarlo luego"
          @click="park"
        >
          <i class="pi pi-pause"></i> Aparcar
        </button>
        <button class="ticket__clear" @click="store.voidTicket()">
          <i class="pi pi-trash"></i> Vaciar
        </button>
      </div>
    </div>

    <div class="ticket__lines">
      <div v-if="isEmpty" class="ticket__empty">
        <i class="pi pi-shopping-cart ticket__empty-icon"></i>
        <div class="ticket__empty-title">Ticket vacío</div>
        <div class="ticket__empty-hint">Toca un producto o escanea<br />un código para empezar</div>
      </div>

      <div
        v-for="l in ticket"
        :key="l.key"
        class="line"
        :class="{ 'line--selected': selectedKey === l.key }"
        @click="store.selectLine(l.key)"
      >
        <div class="line__info">
          <div class="line__name">
            {{ l.name }}
            <span v-if="l.manual?.kind === 'not_found'" class="line__manual">No encontrado</span>
          </div>
          <div class="line__meta">{{ l.qty }} × {{ eur(l.price) }}</div>
        </div>
        <div class="line__controls">
          <button class="line__btn line__btn--dec" @click.stop="store.changeQty(l.key, -1)">
            −
          </button>
          <span class="line__qty">{{ l.qty }}</span>
          <button class="line__btn line__btn--inc" @click.stop="store.changeQty(l.key, 1)">
            +
          </button>
        </div>
        <div class="line__total pos-money">{{ eur(l.price * l.qty) }}</div>
        <button class="line__del" title="Quitar línea" @click.stop="store.removeLine(l.key)">
          <i class="pi pi-times"></i>
        </button>
      </div>
    </div>

    <div class="ticket__foot">
      <div class="ticket__row">
        <span>Base imponible</span><span class="pos-money ticket__row-val">{{ eur(base) }}</span>
      </div>
      <div class="ticket__row">
        <span>IVA (21%)</span><span class="pos-money ticket__row-val">{{ eur(iva) }}</span>
      </div>
      <div class="ticket__total">
        <span class="ticket__total-label">TOTAL</span>
        <span class="ticket__total-val pos-money">{{ eur(total) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ticket {
  grid-area: ticket;
  display: flex;
  flex-direction: column;
  background: var(--pos-panel);
  border-radius: var(--pos-radius-panel);
  box-shadow: var(--pos-shadow-panel);
  overflow: hidden;
  min-height: 0;
}
.ticket__head {
  flex: 0 0 auto;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--pos-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ticket__title {
  font-size: 19px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.ticket__sub {
  font-size: 13px;
  color: var(--pos-text-3);
  font-weight: 700;
}
.ticket__actions {
  display: flex;
  gap: 8px;
}
.ticket__btn {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 13px;
  background: #f8fafc;
  color: var(--pos-green-dark);
  font-size: 13px;
  font-weight: 800;
  border-radius: 8px;
  border: 1px solid var(--pos-border-subtle);
  transition: all 0.12s ease;
}
.ticket__btn:hover:not(:disabled) {
  background: var(--pos-green-soft);
  border-color: var(--pos-green);
}
.ticket__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ticket__btn--parked {
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  border-color: transparent;
}
.ticket__btn--parked b {
  background: var(--pos-warn);
  color: #fff;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 12px;
}
.ticket__clear {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 13px;
  background: #f8fafc;
  color: var(--pos-text-2);
  font-size: 13px;
  font-weight: 700;
  border-radius: 8px;
  border: 1px solid var(--pos-border-subtle);
  transition: all 0.12s ease;
}
.ticket__clear:hover {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
  border-color: #fecaca;
}
.ticket__lines {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 8px 10px;
}
.ticket__empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--pos-text-disabled);
  gap: 14px;
  padding: 30px;
  text-align: center;
}
.ticket__empty-icon {
  font-size: 54px;
}
.ticket__empty-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--pos-text-3);
}
.ticket__empty-hint {
  font-size: 13px;
  line-height: 1.5;
}
.line {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 11px;
  cursor: pointer;
  margin-bottom: 5px;
}
.line--selected {
  background: var(--pos-green-soft);
  box-shadow: inset 3px 0 0 var(--pos-green);
}
.line__info {
  flex: 1;
  min-width: 0;
}
.line__name {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--pos-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.line__meta {
  font-size: 13px;
  color: var(--pos-text-3);
  font-weight: 600;
  margin-top: 3px;
}
.line__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.line__btn {
  width: 33px;
  height: 33px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}
.line__btn--dec {
  background: #f1f5f9;
  color: #475569;
}
.line__btn--dec:hover {
  background: var(--pos-border-medium);
}
.line__btn--inc {
  background: var(--pos-green-soft);
  color: var(--pos-green-hover);
}
.line__btn--inc:hover {
  background: var(--pos-green);
  color: #fff;
}
.line__qty {
  min-width: 26px;
  text-align: center;
  font-weight: 900;
  font-size: 16px;
  color: var(--pos-green-dark);
}
.line__total {
  width: 84px;
  text-align: right;
  font-size: 17px;
  font-weight: 800;
  color: var(--pos-green-dark);
}
.line__del {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: transparent;
  color: var(--pos-text-3);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}
.line__del:hover {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
.ticket__foot {
  flex: 0 0 auto;
  padding: 16px 20px;
  background: #fbfcfd;
  border-top: 1px solid var(--pos-border-subtle);
}
.ticket__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  color: var(--pos-text-2);
  font-weight: 600;
  margin-bottom: 6px;
  white-space: nowrap;
}
.ticket__row:nth-of-type(2) {
  margin-bottom: 12px;
}
.ticket__row-val {
  flex: 0 0 auto;
}
.ticket__total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  white-space: nowrap;
}
.ticket__total-label {
  font-size: 18px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.ticket__total-val {
  font-size: 37px;
  color: var(--pos-green);
  letter-spacing: -0.01em;
  flex: 0 0 auto;
}
.line__manual {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
  vertical-align: middle;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
}
</style>
