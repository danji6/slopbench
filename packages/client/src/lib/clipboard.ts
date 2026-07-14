import { useSyncExternalStore } from 'react'

type ClipboardEntry = { type: string; data: unknown }

let entry: ClipboardEntry | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function copy(type: string, data: unknown) {
  entry = { type, data }
  listeners.forEach((listener) => listener())
}

function clear() {
  entry = null
  listeners.forEach((listener) => listener())
}

export function useClipboard(type: string) {
  const current = useSyncExternalStore(
    subscribe,
    () => entry,
    () => entry,
  )

  return {
    copy: (data: unknown) => copy(type, data),
    paste: current?.type === type ? current.data : null,
    clear,
  }
}
