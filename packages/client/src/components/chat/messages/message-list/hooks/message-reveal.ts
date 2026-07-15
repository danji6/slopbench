import type { useMessageStore } from '@/hooks/chat'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import { useCallback, useEffect, useRef } from 'react'

import type { ScrollDeps } from '../deps'
import {
  appendedMessageIds,
  firstMessageRowIndex,
  latestRemoteUserMessageId,
} from '../helpers'

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

  const revealResolvedMessage = useCallback(
    (resolveMessageId: () => string | undefined) => {
      const topPaddingPx = getNavPaddingPx(topPadding)
      let attempts = 0

      const tryReveal = () => {
        const messageId = resolveMessageId()
        const index =
          messageId === undefined
            ? -1
            : firstMessageRowIndex(rowsRef.current, messageId)
        const virtualizer = virtuaRef.current

        if (index >= 0 && virtualizer) {
          // Note: virtua uses window.scroll for this, which
          // is suppressed during auto-follow
          virtualizer.scrollToIndex(index, {
            align: 'start',
            offset: -topPaddingPx,
          })
          return
        }
        if (++attempts < 30) requestAnimationFrame(tryReveal)
      }

      requestAnimationFrame(tryReveal)
    },
    [topPadding, rowsRef, virtuaRef],
  )

  const revealMessage = useCallback(
    (messageId: string) => revealResolvedMessage(() => messageId),
    [revealResolvedMessage],
  )

  // Bring the latest message into view once it lands
  const revealLatest = useCallback(() => {
    const baselineLength = rowsRef.current.length
    if (!metaRef.current.isAtLiveTail) returnToLatest()
    revealResolvedMessage(() => {
      const current = rowsRef.current
      return current.length > baselineLength
        ? current[current.length - 1]?.messageId
        : undefined
    })
  }, [returnToLatest, revealResolvedMessage, rowsRef, metaRef])

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

  return { revealLatest }
}
