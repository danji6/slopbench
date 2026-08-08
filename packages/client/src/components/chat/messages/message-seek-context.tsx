import { createOptionalContext } from '@/hooks/context'
import type { MessageRow } from '@/lib/chat/rows'
import { useMemo } from 'react'

import type { MessageListHandle } from './message-list/message-list'

/**
 * Scrolls the list to a message from outside of it. `creationTime` lets the
 * list anchor its window around a message that is not loaded yet, and
 * `toolCallId` narrows the landing spot to the block rendering that call.
 */
export type SeekToMessage = (target: {
  messageId: string
  creationTime?: number
  segmentIndex?: number
  toolCallId?: string
  /** Reports the located row, or null when only the message was found. */
  onLocated?: (row: MessageRow | null) => void
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
      ({ messageId, creationTime, segmentIndex, ...options }) => {
        messageListRef.current?.requestScrollToMessage(
          messageId,
          creationTime,
          segmentIndex,
          options,
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
