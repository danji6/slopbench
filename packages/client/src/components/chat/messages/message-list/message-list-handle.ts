import type { SeekTargetOptions } from '@/hooks/chat/message-list/seek'
import { type Ref, useImperativeHandle } from 'react'

export type MessageListHandle = {
  /** Returns to the live tail (loading it if needed) and scrolls to the bottom. */
  followToBottom: () => void
  /** Returns to the conversation start (loading it if needed) and scrolls to the top. */
  followToTop: () => void
  /** Reveals a sent message according to the active scroll mode. */
  revealSentMessage: (id: string, options?: { intoView?: boolean }) => void
  lockScroll: () => void
  scrollByPage: (direction: 1 | -1) => void
  scrollToMessage: (id: string) => void
  /** Scrolls to a message, locating it by creationTime if outside the loaded window. */
  requestScrollToMessage: (
    id: string,
    creationTime?: number,
    segmentIndex?: number,
    options?: SeekTargetOptions,
  ) => void
}

export function useMessageListHandle(
  ref: Ref<MessageListHandle> | undefined,
  actions: MessageListHandle,
  onNavigate?: () => void,
) {
  const {
    followToBottom,
    followToTop,
    revealSentMessage,
    lockScroll,
    scrollByPage,
    scrollToMessage,
    requestScrollToMessage,
  } = actions

  useImperativeHandle(ref, () => {
    const navigate =
      <Args extends unknown[]>(action: (...args: Args) => void) =>
      (...args: Args) => {
        onNavigate?.()
        action(...args)
      }
    return {
      followToBottom: navigate(followToBottom),
      followToTop: navigate(followToTop),
      revealSentMessage,
      lockScroll,
      scrollByPage: navigate(scrollByPage),
      scrollToMessage: navigate(scrollToMessage),
      requestScrollToMessage: navigate(requestScrollToMessage),
    }
  }, [
    followToBottom,
    followToTop,
    revealSentMessage,
    lockScroll,
    scrollByPage,
    scrollToMessage,
    requestScrollToMessage,
    onNavigate,
  ])
}
