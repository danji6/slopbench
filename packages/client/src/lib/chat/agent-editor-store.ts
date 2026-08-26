import { APP_ID } from '@sb/core/const'

import { createLocalStorageStore } from '../local-storage-store'

const STORAGE_KEY = `${APP_ID}-agent-editor-selection`

type Selection = { agentId?: string }

const store = createLocalStorageStore<Selection>(STORAGE_KEY)

export const subscribeEditingAgent = store.subscribe

export function getEditingAgentId(): string | null {
  return store.get().agentId ?? null
}

export function setEditingAgentId(agentId: string | null): void {
  store.set({ agentId: agentId ?? undefined })
}
