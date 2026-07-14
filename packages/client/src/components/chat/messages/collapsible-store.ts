import { useCallback, useSyncExternalStore } from 'react'

const openByKey = new Map<string, boolean>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setOpen(key: string, open: boolean) {
  if ((openByKey.get(key) ?? false) === open) return
  openByKey.set(key, open)
  listeners.forEach((listener) => listener())
}

/** Allows keeping collapsibles expanded when they remount */
export function useCollapsible(key: string, defaultOpen = false) {
  const open = useSyncExternalStore(
    subscribe,
    () => openByKey.get(key) ?? defaultOpen,
    () => defaultOpen,
  )
  const onOpenChange = useCallback(
    (next: boolean) => setOpen(key, next),
    [key],
  )
  return [open, onOpenChange] as const
}
