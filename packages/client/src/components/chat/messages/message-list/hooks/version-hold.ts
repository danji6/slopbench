import { useVersionChange } from '@/hooks/chat/message-version'
import type { MessageStore } from '@/lib/chat/message-store'
import type { ChatStatus } from 'ai'

import type { ScrollDeps } from '../deps'

type VersionHoldOptions = {
  messageIds: string[]
  messageStore: MessageStore
  autoScroll: boolean
  status: ChatStatus
}

/**
 * Holds the scroll position when an already loaded turn's selected version is
 * switched.
 */
export function useVersionHold(
  deps: ScrollDeps,
  { messageIds, messageStore, autoScroll, status }: VersionHoldOptions,
) {
  const { holdPosition } = deps.scroller

  useVersionChange(messageIds, messageStore, () => {
    if (autoScroll && status === 'ready') holdPosition()
  })
}
