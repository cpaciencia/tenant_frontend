import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Actor, Client } from '../../../shared/types'

/**
 * "A cuenta" clients at the till, with what each owes right now. Read from the
 * local mirror (exact offline); `refresh` re-pulls balances from the server.
 */
export const useClientsStore = defineStore('clients', () => {
  const list = ref<Client[]>([])
  const byId = computed(() => new Map(list.value.map((c) => [c.id, c])))

  async function load(): Promise<void> {
    try {
      list.value = await window.api.clients.list()
    } catch {
      // keep what we had
    }
  }

  async function refresh(): Promise<void> {
    try {
      list.value = await window.api.clients.refresh()
    } catch {
      await load()
    }
  }

  async function create(name: string, detail: string | null, actor: Actor): Promise<Client> {
    const client = await window.api.clients.create({ name, detail, actor: { ...actor } })
    await load()
    return client
  }

  function get(id: string | null): Client | null {
    return id ? (byId.value.get(id) ?? null) : null
  }

  return { list, load, refresh, create, get }
})
