import { useSyncExternalStore } from 'react'

let isOpen = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function setAgentEditorOpen(open: boolean) {
  if (isOpen === open) return
  isOpen = open
  emit()
}

export function openAgentEditor() {
  setAgentEditorOpen(true)
}

export function useAgentEditorOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => isOpen,
    () => false,
  )
}
