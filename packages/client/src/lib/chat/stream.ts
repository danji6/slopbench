import type { ActiveStream } from '@sb/convex/types'
import type { ChatStatus } from 'ai'

export function isOngoingStream(status: ChatStatus): boolean {
  return status !== 'ready' && status !== 'error'
}

export function normalizeStatus(stream: ActiveStream | null | undefined) {
  if (!stream) return 'ready'
  return stream.status === 'pending' ? 'submitted' : 'streaming'
}
