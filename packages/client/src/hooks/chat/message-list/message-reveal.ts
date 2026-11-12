import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import {
  appendedMessageIds,
  firstMessageRowIndex,
  latestRemoteUserMessageId,
} from '@/components/chat/messages/message-list/helpers'
import type { useMessageStore } from '@/hooks/chat'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import { useCallback, useEffect, useRef } from 'react'

type RevealOptions = {
  returnToLatest: () => void
  messageIds: string[]
  messageStore: ReturnType<typeof useMessageStore>
  profileId: string | undefined
  isLoading: boolean
  isAtBottom?: boolean
  isAtLiveTail: boolean
}

/** Brings a resolved message to the top of the viewport once it mounts. */
export function useMessageReveal(
  deps: ScrollDeps,
  {
    returnToLatest,
    messageIds,
    messageStore,
    profileId,
    isLoading,
    isAtBottom,
    isAtLiveTail,
  }: RevealOptions,
) {
  const { virtuaRef, rowsRef, metaRef, topPadding } = deps
  const { coordinator, holdPosition } = deps.scroller
  const revealFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(revealFrame.current), [])

  const revealMessage = useCallback(
    (messageId: string, kind: 'follow' | 'navigate' = 'follow') => {
      if (kind === 'follow' && coordinator.kind === 'follow') return
      const operation = coordinator.begin(kind)
      if (!operation) return
      if (kind === 'navigate') holdPosition()
      operation.onCancel(() => cancelAnimationFrame(revealFrame.current))
      const topPaddingPx = getNavPaddingPx(topPadding)
      let attempts = 0

      const tryReveal = () => {
        if (!operation.isCurrent()) return
        const index = firstMessageRowIndex(rowsRef.current, messageId)
        const virtualizer = virtuaRef.current

        if (index >= 0 && virtualizer) {
          // Note: virtua uses window.scroll for this, which
          // is suppressed during auto-follow
          virtualizer.scrollToIndex(index, {
            align: 'start',
            offset: -topPaddingPx,
          })
          operation.finish()
          return
        }
        if (++attempts < 30)
          revealFrame.current = requestAnimationFrame(tryReveal)
        else operation.finish()
      }

      revealFrame.current = requestAnimationFrame(tryReveal)
    },
    [topPadding, rowsRef, virtuaRef, coordinator, holdPosition],
  )

  const revealSentMessage = useCallback(
    (messageId: string) => {
      if (!metaRef.current.isAtLiveTail) returnToLatest()
      revealMessage(messageId, 'navigate')
    },
    [returnToLatest, revealMessage, metaRef],
  )

  const remoteRevealReadyRef = useRef(false)
  const previousRemoteRevealIdsRef = useRef(messageIds)
  // Remote user messages only move clients watching the live tail
  useEffect(() => {
    const previousIds = previousRemoteRevealIdsRef.current
    previousRemoteRevealIdsRef.current = messageIds

    if (isLoading) {
      remoteRevealReadyRef.current = false
      return
    }

    if (!remoteRevealReadyRef.current) {
      remoteRevealReadyRef.current = true
      return
    }

    if (isAtBottom !== true || !isAtLiveTail || !profileId) return

    const appendedIds = appendedMessageIds(previousIds, messageIds)
    if (appendedIds.length === 0) return

    const messageId = latestRemoteUserMessageId(
      appendedIds,
      messageStore,
      profileId,
    )
    if (messageId) revealMessage(messageId)
  }, [
    isAtBottom,
    isAtLiveTail,
    isLoading,
    messageIds,
    messageStore,
    profileId,
    revealMessage,
  ])

  return { revealSentMessage }
}
