<script setup lang="ts">
import { ref } from 'vue'
import { importLegacy, type ImportSummary } from '../../services/admin'
import { useCan } from '../../composables/useCan'

/**
 * Legacy-catalog import screen. Uploads the two exports (categorias + productos)
 * to POST /api/admin/import/legacy, which is idempotent — safe to re-run while the
 * old system stays live. Accepts CSV or TSV (the backend auto-detects).
 *
 * TEMPORARY migration tool: hidden inside Settings (not a menu section), gated by
 * `product:create` (ADMIN already has it). Remove this component for production.
 */
const { can } = useCan()

const categoriasFile = ref<File | null>(null)
const productosFile = ref<File | null>(null)
const running = ref(false)
const error = ref('')
const summary = ref<ImportSummary | null>(null)

function pick(target: 'categorias' | 'productos', event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  if (target === 'categorias') categoriasFile.value = file
  else productosFile.value = file
}

async function run(): Promise<void> {
  if (!categoriasFile.value || !productosFile.value || running.value) return
  running.value = true
  error.value = ''
  summary.value = null
  try {
    summary.value = await importLegacy(categoriasFile.value, productosFile.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo importar el catálogo.'
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div v-if="!can('product:create')" class="bo-card imp-denied">
    <i class="pi pi-lock"></i> No tienes permiso para importar el catálogo.
  </div>

  <div v-else class="imp">
    <!-- Uploader -->
    <div class="bo-card imp-card">
      <div class="imp-head">
        <i class="pi pi-upload"></i>
        <div>
          <div class="imp-title">Importar catálogo del sistema antiguo</div>
          <div class="imp-sub">
            Sube los dos ficheros exportados. Se puede repetir cuantas veces quieras: actualiza lo
            existente y añade lo nuevo (no duplica). Admite CSV o TSV.
          </div>
        </div>
      </div>

      <div class="imp-row">
        <label>Categorías <small>(idcategoria, categoriapadre, borrable)</small></label>
        <input type="file" accept=".csv,.tsv,.txt" @change="pick('categorias', $event)" />
        <span v-if="categoriasFile" class="imp-file">{{ categoriasFile.name }}</span>
      </div>

      <div class="imp-row">
        <label>Productos <small>(idproducto, nombre, precio, idcategoria, stock, idcategoriapadre, borrable)</small></label>
        <input type="file" accept=".csv,.tsv,.txt" @change="pick('productos', $event)" />
        <span v-if="productosFile" class="imp-file">{{ productosFile.name }}</span>
      </div>

      <div class="imp-actions">
        <span v-if="error" class="bo-error"><i class="pi pi-exclamation-triangle"></i> {{ error }}</span>
        <Button
          label="Importar"
          icon="pi pi-database"
          :loading="running"
          :disabled="!categoriasFile || !productosFile"
          @click="run"
        />
      </div>
    </div>

    <!-- Result -->
    <div v-if="summary" class="bo-card imp-card imp-result">
      <div class="imp-title"><i class="pi pi-check-circle"></i> Importación completada</div>
      <div class="imp-grid">
        <div class="imp-stat">
          <span class="imp-stat__label">Cajas</span>
          <span class="imp-stat__val">{{ summary.cajasCreated }} nuevas · {{ summary.cajasUpdated }} actualizadas</span>
        </div>
        <div class="imp-stat">
          <span class="imp-stat__label">Categorías</span>
          <span class="imp-stat__val">{{ summary.categoriesCreated }} nuevas · {{ summary.categoriesUpdated }} actualizadas</span>
        </div>
        <div class="imp-stat">
          <span class="imp-stat__label">Productos</span>
          <span class="imp-stat__val">{{ summary.productsCreated }} nuevos · {{ summary.productsUpdated }} actualizados</span>
        </div>
        <div v-if="summary.productsSkipped > 0" class="imp-stat imp-stat--warn">
          <span class="imp-stat__label">Omitidos</span>
          <span class="imp-stat__val">{{ summary.productsSkipped }} productos sin categoría conocida</span>
        </div>
      </div>
      <p class="imp-note">
        Reinicia la caja (terminal) para que descargue el catálogo actualizado.
      </p>
    </div>

    <!-- Help -->
    <div class="bo-card imp-card imp-help">
      <div class="imp-title">¿Cómo exporto desde MySQL?</div>
      <p>Genera dos ficheros con cabecera. Lo más simple por terminal (TSV):</p>
      <pre>mysql -h 127.0.0.1 -P 3306 -u USUARIO -p --batch camping \
  -e "SELECT idcategoria, categoriapadre, borrable FROM categorias" \
  &gt; categorias.tsv

mysql -h 127.0.0.1 -P 3306 -u USUARIO -p --batch camping \
  -e "SELECT idproducto, nombre, precio, idcategoria, stock, idcategoriapadre, borrable FROM productos" \
  &gt; productos.tsv</pre>
      <p class="imp-note">
        <code>--batch</code> produce TSV (separado por tabuladores), que evita problemas con las comas
        de los nombres. Si prefieres CSV (p. ej. exportando desde DBeaver/MySQL Workbench), también
        vale: el sistema detecta el separador. La columna <code>imagen</code> NO se importa.
      </p>
    </div>
  </div>
</template>

<style scoped>
.imp {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
}
.imp-card {
  padding: 22px 24px;
}
.imp-denied {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px;
  color: var(--pos-text-2);
  font-weight: 600;
}
.imp-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 18px;
}
.imp-head > i {
  font-size: 20px;
  color: var(--pos-green);
  margin-top: 2px;
}
.imp-title {
  font-size: 16px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.imp-sub {
  font-size: 13px;
  color: var(--pos-text-2);
  font-weight: 600;
  margin-top: 2px;
}
.imp-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.imp-row label {
  font-weight: 800;
  font-size: 13px;
  color: var(--pos-text-2);
}
.imp-row label small {
  font-weight: 600;
  color: var(--pos-text-3);
}
.imp-file {
  font-size: 12px;
  color: var(--pos-green-hover);
  font-weight: 700;
}
.imp-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}
.imp-result .imp-title {
  margin-bottom: 14px;
}
.imp-result .imp-title i {
  color: var(--pos-green-hover);
}
.imp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.imp-stat {
  background: #f4f7f9;
  border-radius: 10px;
  padding: 12px 14px;
}
.imp-stat--warn {
  background: #fff7ed;
}
.imp-stat__label {
  display: block;
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.imp-stat__val {
  font-size: 14px;
  font-weight: 700;
  color: var(--pos-green-dark);
}
.imp-note {
  font-size: 12px;
  color: var(--pos-text-3);
  font-weight: 600;
  margin-top: 12px;
}
.imp-help pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 12px;
  overflow-x: auto;
  line-height: 1.5;
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
