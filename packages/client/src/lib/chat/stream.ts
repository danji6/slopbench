import type { Doc } from '@sb/convex/_generated/dataModel'
import type { ChatStatus } from 'ai'

export function isOngoingStream(status: ChatStatus): boolean {
  return status !== 'ready' && status !== 'error'
}

export function normalizeStatus(stream: Doc<'streams'> | null | undefined) {
  if (!stream) return 'ready'
  return stream.status === 'pending' ? 'submitted' : 'streaming'
}
