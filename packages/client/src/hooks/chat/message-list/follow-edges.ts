import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import type { MessageRow } from '@/lib/chat/rows'
import { isOngoingStream } from '@/lib/chat/stream'
import type { ScrollOperation } from '@/lib/scroll-coordinator'
import { trackUntilSettled } from '@/lib/scroll-settle'
import type { ChatStatus } from 'ai'
import { useCallback, useEffect, useRef } from 'react'

type FollowEdgesOptions = {
  returnToLatest: () => void
  returnToOldest: () => void
  status: ChatStatus
  isAtLiveTail: boolean
  canLoadOlder: boolean
  rows: readonly MessageRow[]
  setFollowOverride: (value: boolean) => void
}

/** Reloads and settles at either edge of the conversation (head/tail). */
export function useFollowEdges(
  deps: ScrollDeps,
  {
    returnToLatest,
    returnToOldest,
    status,
    isAtLiveTail,
    canLoadOlder,
    rows,
    setFollowOverride,
  }: FollowEdgesOptions,
) {
  const { scroller, metaRef, docScrollRef } = deps
  const { scrollToBottom, holdPosition, coordinator, unlockScroll } = scroller
  const operationRef = useRef<ScrollOperation | null>(null)
  const pendingBottomRef = useRef(false)
  const pendingTopRef = useRef(false)

  const bottomSettleRef = useRef<(() => void) | null>(null)
  // Scroll until sitting at the very bottom
  const settleToBottom = useCallback(() => {
    const operation = operationRef.current
    if (!operation?.isCurrent()) return
    bottomSettleRef.current?.()
    let cancelled = false
    const cancel = trackUntilSettled(
      () => {
        if (!operation.isCurrent()) return 0
        const doc = docScrollRef.current
        if (!doc) return null
        const distance = doc.scrollHeight - window.scrollY - window.innerHeight
        if (distance > 1) scrollToBottom(true)
        return distance
      },
      {
        pending: () =>
          pendingBottomRef.current ||
          metaRef.current.isLoadingNewer ||
          coordinator.layoutPending,
        onDone: () => {
          if (cancelled) return
          if (operation.isCurrent() && metaRef.current.isAtLiveTail) {
            operation.finish()
            unlockScroll(true)
          }
        },
      },
    )
    bottomSettleRef.current = () => {
      cancelled = true
      cancel()
    }
  }, [scrollToBottom, docScrollRef, metaRef, unlockScroll, coordinator])
  useEffect(() => () => bottomSettleRef.current?.(), [])

  const topSettleRef = useRef<(() => void) | null>(null)
  // Scroll until sitting at the very top
  const settleToTop = useCallback(() => {
    const operation = operationRef.current
    if (!operation?.isCurrent()) return
    topSettleRef.current?.()
    holdPosition()
    topSettleRef.current = trackUntilSettled(
      () => {
        if (!operation.isCurrent()) return 0
        if (window.scrollY > 1) window.scrollTo({ top: 0, behavior: 'instant' })
        return window.scrollY
      },
      {
        onDone: () => {
          if (operation.isCurrent() && !metaRef.current.canLoadOlder)
            operation.finish()
        },
      },
    )
  }, [holdPosition, metaRef])
  useEffect(() => () => topSettleRef.current?.(), [])

  const beginNavigation = useCallback(
    (exclusive = false) => {
      const operation = coordinator.begin('navigate', { exclusive })
      operationRef.current = operation
      operation?.onCancel(() => {
        bottomSettleRef.current?.()
        topSettleRef.current?.()
        pendingBottomRef.current = false
        pendingTopRef.current = false
      })
    },
    [coordinator],
  )

  // Reload the live tail and scroll to the bottom, unloading older pages
  const followToBottom = useCallback(() => {
    beginNavigation(true)
    scrollToBottom(true)
    setFollowOverride(isOngoingStream(status))
    if (!metaRef.current.isAtLiveTail) pendingBottomRef.current = true
    returnToLatest()
    settleToBottom()
  }, [
    settleToBottom,
    status,
    returnToLatest,
    setFollowOverride,
    metaRef,
    beginNavigation,
    scrollToBottom,
  ])

  // Ensure the list is at the very bottom when the live tail reloads
  useEffect(() => {
    if (!pendingBottomRef.current || !isAtLiveTail) return
    pendingBottomRef.current = false
    settleToBottom()
  }, [isAtLiveTail, rows, settleToBottom])

  // Reload the oldest page if needed, then scroll to the very top
  const followToTop = useCallback(() => {
    beginNavigation()
    if (metaRef.current.canLoadOlder) {
      pendingTopRef.current = true
      returnToOldest()
    }
    settleToTop()
  }, [settleToTop, returnToOldest, metaRef, beginNavigation])

  // Ensure the list is at the very top once the head window loads
  useEffect(() => {
    if (!pendingTopRef.current || canLoadOlder) return
    pendingTopRef.current = false
    settleToTop()
  }, [canLoadOlder, rows, settleToTop])

  return { followToBottom, followToTop }
}
