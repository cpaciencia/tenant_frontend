<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listTickets, getTicket, type TicketView, type TicketDetail } from '../../services/admin'

/**
 * Ticket (sale) history from the backend (web + desktop): date, total, and a
 * per-ticket detail with its lines. Read-only; the till issues tickets.
 */
const tickets = ref<TicketView[]>([])
const loading = ref(false)
const error = ref('')

const detailOpen = ref(false)
const detail = ref<TicketDetail | null>(null)
const detailLoading = ref(false)

function eur(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    tickets.value = await listTickets(0, 100)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el histórico de tickets'
  } finally {
    loading.value = false
  }
}

async function openDetail(t: TicketView): Promise<void> {
  detailOpen.value = true
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await getTicket(t.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el ticket'
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <span v-if="error" class="bo-error">{{ error }}</span>
    <DataTable
      :value="tickets"
      :loading="loading"
      data-key="id"
      paginator
      :rows="15"
      class="bo-card"
    >
      <template #empty><div class="tk-empty">Aún no hay tickets.</div></template>
      <Column field="ticketNumber" header="Ticket" sortable />
      <Column header="Fecha"
        ><template #body="{ data }">{{ fmtDate(data.createdAt) }}</template></Column
      >
      <Column field="terminalId" header="Puesto" />
      <Column header="Total">
        <template #body="{ data }"
          ><span class="pos-money">{{ eur(data.totalCents) }}</span></template
        >
      </Column>
      <Column header="">
        <template #body="{ data }"
          ><Button label="Ver" text size="small" @click="openDetail(data)"
        /></template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="detailOpen"
      modal
      :style="{ width: '34rem' }"
      :header="detail ? `Ticket ${detail.ticket.ticketNumber}` : 'Detalle del ticket'"
    >
      <div v-if="detailLoading" class="tk-empty">Cargando…</div>
      <div v-else-if="detail">
        <div class="tk-head">
          {{ fmtDate(detail.ticket.createdAt) }} · {{ detail.ticket.terminalId }}
        </div>
        <div v-for="(l, i) in detail.lines" :key="i" class="tk-line">
          <span class="tk-line__name">{{ l.quantity }}× {{ l.name }}</span>
          <span class="pos-money">{{ eur(l.lineCents) }}</span>
        </div>
        <div class="tk-total">
          <span>Total</span>
          <span class="pos-money">{{ eur(detail.ticket.totalCents) }}</span>
        </div>
      </div>
      <template #footer><Button label="Cerrar" text @click="detailOpen = false" /></template>
    </Dialog>
  </div>
</template>

<style scoped>
.tk-empty {
  padding: 16px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.tk-head {
  font-size: 13px;
  color: var(--pos-text-2);
  font-weight: 600;
  margin-bottom: 12px;
}
.tk-line {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: var(--pos-text);
  padding: 7px 0;
  border-bottom: 1px solid #f4f7f9;
}
.tk-line__name {
  color: var(--pos-text);
}
.tk-total {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 16px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
