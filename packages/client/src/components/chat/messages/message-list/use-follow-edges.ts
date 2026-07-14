import type { MessageRow } from '@/lib/chat/rows'
import { isOngoingStream } from '@/lib/chat/stream'
import { trackUntilSettled } from '@/lib/scroll-settle'
import type { ChatStatus } from 'ai'
import { useCallback, useEffect, useRef } from 'react'

import type { ScrollDeps } from './deps'

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
  const { scrollToBottom, holdPosition } = scroller

  const bottomSettleRef = useRef<(() => void) | null>(null)
  // Scroll until sitting at the very bottom
  const settleToBottom = useCallback(() => {
    bottomSettleRef.current?.()
    bottomSettleRef.current = trackUntilSettled(() => {
      const doc = docScrollRef.current
      if (!doc) return null
      const distance = doc.scrollHeight - window.scrollY - window.innerHeight
      if (distance > 1) scrollToBottom(true)
      return distance
    })
  }, [scrollToBottom, docScrollRef])
  useEffect(() => () => bottomSettleRef.current?.(), [])

  const topSettleRef = useRef<(() => void) | null>(null)
  // Scroll until sitting at the very top
  const settleToTop = useCallback(() => {
    topSettleRef.current?.()
    holdPosition()
    topSettleRef.current = trackUntilSettled(() => {
      if (window.scrollY > 1) window.scrollTo({ top: 0, behavior: 'instant' })
      return window.scrollY
    })
  }, [holdPosition])
  useEffect(() => () => topSettleRef.current?.(), [])

  const pendingBottomRef = useRef(false)
  // Reload the live tail and scroll to the bottom, unloading older pages
  const followToBottom = useCallback(() => {
    setFollowOverride(isOngoingStream(status))
    if (!metaRef.current.isAtLiveTail) pendingBottomRef.current = true
    returnToLatest()
    settleToBottom()
  }, [settleToBottom, status, returnToLatest, setFollowOverride, metaRef])

  // Ensure the list is at the very bottom when the live tail reloads
  useEffect(() => {
    if (!pendingBottomRef.current || !isAtLiveTail) return
    pendingBottomRef.current = false
    settleToBottom()
  }, [isAtLiveTail, rows, settleToBottom])

  const pendingTopRef = useRef(false)
  // Reload the oldest page if needed, then scroll to the very top
  const followToTop = useCallback(() => {
    if (metaRef.current.canLoadOlder) {
      pendingTopRef.current = true
      returnToOldest()
    }
    settleToTop()
  }, [settleToTop, returnToOldest, metaRef])

  // Ensure the list is at the very top once the head window loads
  useEffect(() => {
    if (!pendingTopRef.current || canLoadOlder) return
    pendingTopRef.current = false
    settleToTop()
  }, [canLoadOlder, rows, settleToTop])

  return { followToBottom, followToTop }
}
