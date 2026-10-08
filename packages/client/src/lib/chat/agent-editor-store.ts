import { APP_ID } from '@sb/core/const'

import { createLocalStorageStore } from '../local-storage-store'

const STORAGE_KEY = `${APP_ID}-agent-editor-selection`

type Selection = {
  agentId?: string
  newAgent?: boolean
  /** Retains a successful create when a later avatar upload needs retrying. */
  createdAgentId?: string
}

const store = createLocalStorageStore<Selection>(STORAGE_KEY)

export const subscribeEditingAgent = store.subscribe

export function getEditingAgentId(): string | null {
  return store.get().agentId ?? null
}

export function setEditingAgentId(agentId: string | null): void {
  store.set({
    agentId: agentId ?? undefined,
    newAgent: undefined,
    createdAgentId: undefined,
  })
}

export function isNewAgent(): boolean {
  return store.get().newAgent === true
}

export function startNewAgent(): void {
  store.set({ agentId: undefined, newAgent: true, createdAgentId: undefined })
}

export function getCreatedAgentId(): string | undefined {
  return store.get().createdAgentId
}

export function setCreatedAgentId(id: string): void {
  store.set({ createdAgentId: id })
}
