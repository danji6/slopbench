import { getNavPaddingPx } from '@/hooks/nav-padding'
import { useEffect, useRef } from 'react'

/** Unlocks auto-follow when locally owned activity becomes visible at the tail. */
export function useConditionalFollow(
  messageId: string | null,
  shouldFollowStream: boolean,
  unlockScroll: (force?: boolean) => void,
) {
  const prevRef = useRef(messageId)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = messageId
    if (messageId && prev !== messageId && shouldFollowStream) {
      unlockScroll(true)
    }
  }, [messageId, shouldFollowStream, unlockScroll])
}

export type ConditionalScrollArgs = {
  autoScroll: boolean
  messageId: string | null
  shouldRevealStream: boolean
  scrollRef: React.RefObject<HTMLElement | null>
  scrollUntilCondition: (condition: () => boolean) => void
  topPadding: number
}

/** Reveals starting activity when not auto-following, until its head clears the nav. */
export function useConditionalScroll(args: ConditionalScrollArgs) {
  const {
    autoScroll,
    messageId,
    shouldRevealStream,
    scrollRef,
    scrollUntilCondition,
    topPadding,
  } = args

  const prevMessageIdRef = useRef(messageId)
  useEffect(() => {
    const prev = prevMessageIdRef.current
    prevMessageIdRef.current = messageId

    if (autoScroll) return
    if (!messageId || prev === messageId) return
    if (!shouldRevealStream) return

    const topPaddingPx = getNavPaddingPx(topPadding)
    scrollUntilCondition(() => {
      const container = scrollRef.current
      if (!container) return false

      // Measure a message's first mounted row
      const firstEl = container.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      )
      return !!firstEl && firstEl.getBoundingClientRect().top <= topPaddingPx
    })
  }, [
    autoScroll,
    messageId,
    shouldRevealStream,
    scrollRef,
    scrollUntilCondition,
    topPadding,
  ])
}
