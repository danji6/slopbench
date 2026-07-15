import type { useMessageStore } from '@/hooks/chat'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import {
  getSavedScroll,
  setSavedScroll,
} from '@/lib/chat/scroll-position-store'
import { useCallback, useEffect, useRef } from 'react'

import type { ScrollDeps } from '../deps'
import type { SeekTargetOptions } from './seek'

/** Debounce for capturing the scroll position while the user scrolls. */
const CAPTURE_DEBOUNCE_MS = 300
/** Delay before capture arms, letting the initial/restored scroll settle first. */
const ARM_DELAY_MS = 500

type PersistenceOptions = {
  sessionId: string | undefined
  messageStore: ReturnType<typeof useMessageStore>
  /** Whether the viewport is currently pinned to the bottom of the list. */
  isAtBottom: boolean | undefined
  requestScrollToMessage: (
    id: string,
    creationTime?: number,
    segmentIndex?: number,
    options?: SeekTargetOptions,
  ) => void
  followToBottom: () => void
  /** Called once a restored position has settled (or was abandoned). */
  onRestoreSettled: () => void
}

/** Persists and restores session scroll position across reloads. */
export function useScrollPersistence(
  deps: ScrollDeps,
  {
    sessionId,
    messageStore,
    isAtBottom,
    requestScrollToMessage,
    followToBottom,
    onRestoreSettled,
  }: PersistenceOptions,
) {
  const { metaRef, topPadding } = deps

  const isAtBottomRef = useRef(isAtBottom)
  const onRestoreSettledRef = useRef(onRestoreSettled)
  useEffect(() => {
    isAtBottomRef.current = isAtBottom
    onRestoreSettledRef.current = onRestoreSettled
  })

  const armedRef = useRef(false)

  const capture = useCallback(() => {
    if (!armedRef.current || !sessionId) return

    const topPaddingPx = getNavPaddingPx(topPadding)
    const items = document.querySelectorAll<HTMLElement>(
      '[data-slot="virtualized-item"][data-message-id]',
    )

    // Topmost row still intersecting the viewport below the nav padding
    let anchor: HTMLElement | undefined
    for (const item of items) {
      if (item.getBoundingClientRect().bottom > topPaddingPx + 1) {
        anchor = item
        break
      }
    }
    const anchorId = anchor?.dataset.messageId
    if (!anchor || !anchorId) return

    const meta = messageStore.getMessageMetadata(anchorId)
    // Whether the auto scroller is currently active
    const following =
      metaRef.current.isAtLiveTail && isAtBottomRef.current === true

    // A non-following restore needs the creation time to relocate an unloaded anchor
    if (!following && meta?._creationTime === undefined) return

    // Anchor to the row within the message
    const segmentIndex = anchor.dataset.segmentIndex
    const offset = anchor.getBoundingClientRect().top - topPaddingPx

    setSavedScroll(sessionId, {
      anchorId,
      creationTime: meta?._creationTime ?? 0,
      segmentIndex:
        segmentIndex !== undefined ? Number(segmentIndex) : undefined,
      rowKey: anchor.dataset.rowKey,
      offset,
      following,
    })
  }, [sessionId, topPadding, messageStore, metaRef])

  const captureRef = useRef(capture)
  useEffect(() => {
    captureRef.current = capture
  }, [capture])

  // Debounced capture while scrolling
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => captureRef.current(), CAPTURE_DEBOUNCE_MS)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Capture the final position when leaving the session
  useEffect(() => () => captureRef.current(), [])

  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
    },
    [],
  )
  const arm = useCallback(() => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    armTimerRef.current = setTimeout(() => {
      armedRef.current = true
    }, ARM_DELAY_MS)
  }, [])

  // Restores a saved position. Returns true if it took over scrolling.
  const restore = useCallback((): boolean => {
    arm()
    const saved = sessionId ? getSavedScroll(sessionId) : undefined
    if (!saved || saved.following) return false

    requestScrollToMessage(
      saved.anchorId,
      saved.creationTime,
      saved.segmentIndex,
      {
        offset: saved.offset,
        rowKey: saved.rowKey,
        onSettled: () => onRestoreSettledRef.current(),
        onNotFound: () => {
          followToBottom() // fall back to the bottom
          onRestoreSettledRef.current()
        },
      },
    )
    return true
  }, [arm, sessionId, requestScrollToMessage, followToBottom])

  return { restore }
}
