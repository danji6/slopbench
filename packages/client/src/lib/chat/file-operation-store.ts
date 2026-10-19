import type { Id } from '@sb/convex/_generated/dataModel'
import { APP_ID } from '@sb/core/const'

type OperationState = {
  id?: Id<'agentFileOperations'>
  pending: boolean
  submitting?: boolean
  ignoreVersion?: number
  error?: string
  dismissed?: boolean
  restoring?: boolean
}

const states = new Map<string, OperationState>()
const listeners = new Map<string, Set<() => void>>()

/** Shares submission and recovery state across every control for one home. */
export function fileOperationStore(key: string) {
  const storageKey = `${APP_ID}-active-agent-files:${key}`
  if (!states.has(key)) {
    let id: Id<'agentFileOperations'> | undefined
    try {
      id = (localStorage.getItem(storageKey) as typeof id) || undefined
    } catch {
      /* Storage is optional. */
    }
    states.set(key, { id, pending: !!id, restoring: !!id })
  }
  return {
    read: () => states.get(key)!,
    subscribe: (listener: () => void) => {
      const set = listeners.get(key) ?? new Set()
      listeners.set(key, set)
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    update: (patch: Partial<OperationState>) => {
      const next = { ...states.get(key)!, ...patch }
      states.set(key, next)
      try {
        if (next.id && next.pending) localStorage.setItem(storageKey, next.id)
        else localStorage.removeItem(storageKey)
      } catch {
        /* Storage is optional. */
      }
      for (const listener of listeners.get(key) ?? []) listener()
    },
  }
}
