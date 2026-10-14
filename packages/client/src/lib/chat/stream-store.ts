import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActiveStream } from '@sb/convex/types'

import { normalizeStatus } from './stream'

export type StreamStore = ReturnType<typeof createStreamStore>

/** Granular active stream store to minimize unnecessary re-renders. */
export function createStreamStore() {
  let stream: ActiveStream | null = null
  const listeners = new Set<() => void>()

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const sync = (next: ActiveStream | null) => {
    stream = next
    listeners.forEach((listener) => listener())
  }

  return {
    subscribe,
    sync,
    getStream: (): ActiveStream | null => stream,
    getNormalizedStatus: () => normalizeStatus(stream),
    getRawStatus: (): ActiveStream['status'] | undefined => stream?.status,
    getProcessingMessageId: (): Id<'messages'> | undefined =>
      stream?.processingMessageId,
    getInvokedBy: (): Id<'users'> | undefined => stream?.invokedBy,
    getStreamId: (): Id<'streams'> | undefined => stream?._id,
    getFireAt: (): number | undefined => stream?.fireAt,
    getRetryAt: (): number | undefined => stream?.retryAt,
    getRetryError: (): string | undefined => stream?.retryError,
    getAttempt: (): number | undefined => stream?.attempt,
  }
}
