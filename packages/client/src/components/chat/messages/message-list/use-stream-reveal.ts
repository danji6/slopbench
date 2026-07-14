import { getNavPaddingPx } from '@/hooks/nav-padding'
import type { ChatStatus } from 'ai'
import { useEffect, useRef } from 'react'

/** Unlocks auto-follow when a locally owned stream starts at the live tail. */
export function useConditionalFollow(
  status: ChatStatus,
  shouldFollowStream: boolean,
  unlockScroll: (force?: boolean) => void,
) {
  const prevRef = useRef(status)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = status
    if (prev === 'ready' && status !== 'ready' && shouldFollowStream) {
      unlockScroll(true)
    }
  }, [status, shouldFollowStream, unlockScroll])
}

/** Reveals a starting stream when not auto-following, until its head clears the nav. */
export function useConditionalScroll(
  autoScroll: boolean,
  status: ChatStatus,
  shouldRevealStream: boolean,
  scrollRef: React.RefObject<HTMLElement | null>,
  scrollUntilCondition: (condition: () => boolean) => void,
  topPadding: number,
  messageIds: string[],
  processingMessageId: string | null,
) {
  const messageIdsRef = useRef(messageIds)
  const processingMessageIdRef = useRef(processingMessageId)

  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status

    if (autoScroll) return
    if (prev !== 'ready' || status === 'ready') return
    if (!shouldRevealStream) return

    const topPaddingPx = getNavPaddingPx(topPadding)
    const existingIds = new Set(messageIdsRef.current)

    scrollUntilCondition(() => {
      const container = scrollRef.current
      if (!container) return false

      const allMsgEls =
        container.querySelectorAll<HTMLElement>('[data-message-id]')
      if (allMsgEls.length === 0) return false

      const lastEl = allMsgEls[allMsgEls.length - 1]
      const lastId = lastEl.dataset.messageId ?? ''
      const pid = processingMessageIdRef.current
      if (pid ? lastId !== pid : existingIds.has(lastId)) return false

      // Measure a message's first mounted row
      const firstEl = container.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(lastId)}"]`,
      )
      return (firstEl ?? lastEl).getBoundingClientRect().top <= topPaddingPx
    })
  }, [
    autoScroll,
    status,
    shouldRevealStream,
    scrollRef,
    scrollUntilCondition,
    topPadding,
  ])

  useEffect(() => {
    messageIdsRef.current = messageIds
  }, [messageIds])

  useEffect(() => {
    processingMessageIdRef.current = processingMessageId
  }, [processingMessageId])
}
