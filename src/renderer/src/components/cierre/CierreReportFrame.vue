<script setup lang="ts">
/**
 * On-screen cierre de caja. Renders the exact same self-contained HTML that is
 * exported to PDF (in an isolated iframe), so what the cashier checks is what
 * gets saved/printed. Used by the POS and the Backoffice.
 */
import { computed } from 'vue'
import {
  buildCierreReportHtml,
  type CierreReportData,
  type ReportBusiness
} from '../../reports/cierreReport'

const props = defineProps<{ cierre: CierreReportData; business: ReportBusiness }>()

const html = computed(() => buildCierreReportHtml(props.cierre, props.business))
</script>

<template>
  <iframe class="cierre-frame" :srcdoc="html" sandbox="" title="Cierre de caja"></iframe>
</template>

<style scoped>
.cierre-frame {
  width: 100%;
  height: 62vh;
  border: 1px solid var(--pos-border-subtle, #e2e8f0);
  border-radius: 10px;
  background: #fff;
}
</style>
