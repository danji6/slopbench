import { createOptionalContext } from '@/hooks/context'
import { useMemo } from 'react'

import type { MessageListHandle } from './message-list/message-list'

/**
 * Scrolls the list to a message from outside of it. `creationTime` lets the
 * list anchor its window around a message that is not loaded yet.
 */
export type SeekToMessage = (target: {
  messageId: string
  creationTime?: number
  segmentIndex?: number
}) => void

export const [MessageSeekContext, useMessageSeek] =
  createOptionalContext<SeekToMessage>()

export function MessageSeekProvider({
  messageListRef,
  children,
}: {
  messageListRef: React.RefObject<MessageListHandle | null>
  children: React.ReactNode
}) {
  const seek = useMemo<SeekToMessage>(
    () =>
      ({ messageId, creationTime, segmentIndex }) => {
        messageListRef.current?.requestScrollToMessage(
          messageId,
          creationTime,
          segmentIndex,
        )
      },
    [messageListRef],
  )

  return (
    <MessageSeekContext.Provider value={seek}>
      {children}
    </MessageSeekContext.Provider>
  )
}
