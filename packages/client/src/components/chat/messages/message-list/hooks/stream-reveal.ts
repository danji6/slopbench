import { getNavPaddingPx } from '@/hooks/nav-padding'
import { useEffect, useRef } from 'react'

/** Unlocks auto-follow when locally owned activity starts at the live tail. */
export function useConditionalFollow(
  active: boolean,
  shouldFollowStream: boolean,
  unlockScroll: (force?: boolean) => void,
) {
  const prevRef = useRef(active)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = active
    if (!prev && active && shouldFollowStream) {
      unlockScroll(true)
    }
  }, [active, shouldFollowStream, unlockScroll])
}

export type ConditionalScrollArgs = {
  autoScroll: boolean
  active: boolean
  shouldRevealStream: boolean
  scrollRef: React.RefObject<HTMLElement | null>
  scrollUntilCondition: (condition: () => boolean) => void
  topPadding: number
  messageIds: string[]
  processingMessageId: string | null
}

/** Reveals starting activity when not auto-following, until its head clears the nav. */
export function useConditionalScroll(args: ConditionalScrollArgs) {
  const {
    autoScroll,
    active,
    shouldRevealStream,
    scrollRef,
    scrollUntilCondition,
    topPadding,
    messageIds,
    processingMessageId,
  } = args

  const messageIdsRef = useRef(messageIds)
  const processingMessageIdRef = useRef(processingMessageId)

  const prevActiveRef = useRef(active)
  useEffect(() => {
    const prev = prevActiveRef.current
    prevActiveRef.current = active

    if (autoScroll) return
    if (prev || !active) return
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
    active,
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
