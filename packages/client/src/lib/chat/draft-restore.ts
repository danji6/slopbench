import { useSyncExternalStore } from 'react'

/** A stored draft waiting on the user's decision before it is applied. */
export type DraftRestoreRequest = {
  key: string
  /** What the draft belongs to, read as "unsaved changes to <label>". */
  label: string
  apply: () => void
  discard: () => void
}

const queue: DraftRestoreRequest[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/**
 * Queues a draft for confirmation.
 *
 * Requests are answered one at a time rather than merged, because an editor
 * nested in another one only mounts once its parent has been restored.
 */
export function requestDraftRestore(request: DraftRestoreRequest) {
  const index = queue.findIndex((r) => r.key === request.key)
  if (index >= 0) queue[index] = request
  else queue.push(request)
  emit()
}

/** Whether a draft is still waiting on the user's decision. */
export function isDraftPending(key: string): boolean {
  return queue.some((request) => request.key === key)
}

const withdrawals = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Takes back the unanswered question of an editor that is going away, so that
 * it cannot be answered into an editor the user has already left.
 *
 * Deferred because a remount (or strict mode) tears the editor down and builds
 * it again within the same commit. The rebuilt editor calls `keepDraftRestore`
 * and cancels this.
 */
export function releaseDraftRestore(key: string) {
  clearTimeout(withdrawals.get(key))
  withdrawals.set(
    key,
    setTimeout(() => {
      withdrawals.delete(key)
      const index = queue.findIndex((r) => r.key === key)
      if (index < 0) return
      queue.splice(index, 1)
      emit()
    }),
  )
}

/** Cancels a pending withdrawal. */
export function keepDraftRestore(key: string) {
  const timer = withdrawals.get(key)
  if (timer === undefined) return
  clearTimeout(timer)
  withdrawals.delete(key)
}

function resolve(request: DraftRestoreRequest, action?: 'apply' | 'discard') {
  if (queue[0] !== request) return
  queue.shift()
  if (action === 'apply') request.apply()
  else if (action === 'discard') request.discard()
  emit()
}

export const draftRestore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  peek: (): DraftRestoreRequest | undefined => queue[0],
  restore: (request: DraftRestoreRequest) => resolve(request, 'apply'),
  discard: (request: DraftRestoreRequest) => resolve(request, 'discard'),
  dismiss: (request: DraftRestoreRequest) => resolve(request),
}

const noPending = () => undefined

/** The request the confirmation dialog is currently asking about. */
export function usePendingDraftRestore(): DraftRestoreRequest | undefined {
  return useSyncExternalStore(
    draftRestore.subscribe,
    draftRestore.peek,
    noPending,
  )
}
