<script setup lang="ts">
/**
 * Upload the invoice of one supplier payment: pick a file on the till, or show a
 * QR so a phone uploads it (polled until the server has it). Once the server
 * confirms, the payment is marked as having its invoice (audited) and `uploaded`
 * is emitted. Used from Movimientos and from the Pendientes inbox.
 */
import { onUnmounted, ref } from 'vue'
import QRCode from 'qrcode'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'
import {
  INVOICE_ACCEPT,
  createUploadToken,
  findInvoice,
  invoiceErrorMessage,
  revokeUploadToken,
  uploadInvoice
} from '../../services/invoices'
import type { CashMovement } from '../../../../shared/types'

const props = defineProps<{ movement: CashMovement }>()
const emit = defineEmits<{ (e: 'uploaded', fileName: string): void; (e: 'cancel'): void }>()
const store = usePosStore()

const busy = ref(false)
const error = ref('')
const qrDataUrl = ref('')
const qrExpiresAt = ref('')
const qrExpired = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
/** The live QR link (one per payment: a new one invalidates it on the server). */
let qrToken: string | null = null
let qrExpiresMs = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

/** Close the QR link on the server (cancel, leave, or switched to a file). */
function dropQr(): void {
  stopPolling()
  if (qrToken) void revokeUploadToken(qrToken)
  qrToken = null
}
onUnmounted(dropQr)

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

async function done(fileName: string, via: 'file' | 'qr'): Promise<void> {
  stopPolling()
  qrToken = null // the server closed every link of this payment with the upload
  await window.api.cashMovements.markInvoiceUploaded({
    cashMovementId: props.movement.id,
    fileName,
    via,
    actor: store.actor()
  })
  void store.refreshInvoicesPending()
  emit('uploaded', fileName)
}

async function onFilePicked(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  error.value = ''
  try {
    const inv = await uploadInvoice(props.movement, file)
    await done(inv.fileName, 'file')
  } catch (e) {
    error.value = invoiceErrorMessage(e)
  } finally {
    busy.value = false
  }
}

async function showQr(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    stopPolling()
    const t = await createUploadToken(props.movement) // invalidates any previous QR
    qrToken = t.token
    qrExpiresMs = new Date(t.expiresAt).getTime()
    qrExpired.value = false
    qrDataUrl.value = await QRCode.toDataURL(t.url, { width: 260, margin: 1 })
    qrExpiresAt.value = fmtTime(t.expiresAt)
    pollTimer = setInterval(async () => {
      if (Date.now() >= qrExpiresMs) {
        stopPolling()
        qrExpired.value = true
        return
      }
      try {
        const inv = await findInvoice(props.movement.id)
        if (inv && pollTimer) await done(inv.fileName, 'qr')
      } catch {
        // transient: keep polling
      }
    }, 3000)
  } catch (e) {
    error.value = invoiceErrorMessage(e)
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  dropQr()
  emit('cancel')
}
</script>

<template>
  <div class="iu">
    <div class="iu-title">
      <i class="pi pi-file"></i> Factura de <b>{{ movement.supplier }}</b> ·
      <span class="pos-money">{{ eur(movement.amountCents / 100) }}</span>
      <small v-if="movement.document"> · {{ movement.document }}</small>
    </div>
    <div class="iu-hint">
      Es obligatoria: sin ella no se puede cerrar la caja. Súbela ahora o más tarde desde el buzón
      de pendientes o desde Movimientos.
    </div>

    <div v-if="!qrDataUrl" class="iu-actions">
      <button class="iu-btn" :disabled="busy" @click="fileInput?.click()">
        <i class="pi pi-upload"></i>
        <span>{{ busy ? 'Subiendo…' : 'Subir archivo' }}</span>
        <small>PDF o foto</small>
      </button>
      <button class="iu-btn" :disabled="busy" @click="showQr">
        <i class="pi pi-qrcode"></i>
        <span>Subir con el móvil</span>
        <small>Escanea un QR y haz la foto</small>
      </button>
    </div>

    <div v-else class="iu-qr">
      <img
        :src="qrDataUrl"
        :class="{ 'iu-qr__img--expired': qrExpired }"
        alt="QR para subir la factura"
        width="260"
        height="260"
      />
      <div class="iu-qr__text">
        <template v-if="!qrExpired">
          Escanea el código con el móvil, haz la foto de la factura y pulsa
          <b>Subir factura</b>.<br />
          <span class="iu-qr__wait"
            ><i class="pi pi-spin pi-spinner"></i> Esperando la factura… (válido hasta las
            {{ qrExpiresAt }})</span
          >
        </template>
        <span v-else class="iu-qr__expired"
          ><i class="pi pi-clock"></i> Este QR ha caducado. Genera otro.</span
        >
        <div class="iu-qr__alt">
          <button class="iu-mini" :disabled="busy" @click="showQr">
            <i class="pi pi-refresh"></i> Generar otro QR
          </button>
          <button class="iu-mini" :disabled="busy" @click="fileInput?.click()">
            <i class="pi pi-upload"></i> {{ busy ? 'Subiendo…' : 'Subir archivo' }}
          </button>
        </div>
        <small class="iu-qr__note">Al generar otro, el QR anterior deja de funcionar.</small>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      class="iu-file"
      :accept="INVOICE_ACCEPT"
      @change="onFilePicked"
    />

    <span v-if="error" class="iu-error"
      ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
    >

    <button class="iu-later" @click="cancel">{{ qrDataUrl ? 'Cancelar' : 'Más tarde' }}</button>
  </div>
</template>

<style scoped>
.iu {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.iu-title {
  font-size: 17px;
  font-weight: 800;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.iu-hint {
  font-size: 13px;
  color: var(--pos-text-2);
}
.iu-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 6px;
}
.iu-btn {
  min-height: 110px;
  border-radius: 14px;
  border: 2px solid var(--pos-green);
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-weight: 900;
  font-size: 16px;
}
.iu-btn i {
  font-size: 28px;
}
.iu-btn small {
  font-weight: 600;
  font-size: 12px;
  color: var(--pos-text-2);
}
.iu-btn:disabled {
  opacity: 0.6;
}
.iu-file {
  display: none;
}
.iu-qr {
  display: flex;
  gap: 16px;
  align-items: center;
}
.iu-qr img {
  border-radius: 10px;
  border: 1px solid var(--pos-border-subtle);
}
.iu-qr__text {
  font-size: 14px;
  line-height: 1.5;
}
.iu-qr__wait {
  display: inline-block;
  margin-top: 8px;
  color: var(--pos-text-2);
  font-weight: 700;
}
.iu-qr__img--expired {
  opacity: 0.25;
  filter: grayscale(1);
}
.iu-qr__expired {
  color: var(--pos-danger);
  font-weight: 800;
}
.iu-qr__alt {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.iu-mini {
  height: 44px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1.5px solid var(--pos-green);
  background: #fff;
  color: var(--pos-green-dark);
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 8px;
}
.iu-mini:disabled {
  opacity: 0.6;
}
.iu-qr__note {
  display: block;
  margin-top: 6px;
  color: var(--pos-text-3);
}
.iu-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.iu-later {
  height: 48px;
  border-radius: 12px;
  background: #f4f7f9;
  color: var(--pos-text-2);
  font-weight: 900;
}
</style>
