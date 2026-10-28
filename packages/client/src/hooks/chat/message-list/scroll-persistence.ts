import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import type { useMessageStore } from '@/hooks/chat'
import type { SeekTargetOptions } from '@/hooks/chat/message-list/seek'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import { scrollRowAddress } from '@/lib/chat/scroll-address'
import {
  getSavedScroll,
  setSavedScroll,
} from '@/lib/chat/scroll-position-store'
import { captureWindowScrollAnchor } from '@/lib/chat/window-scroll-anchor'
import { scrollDebug } from '@/lib/scroll-debug'
import { useCallback, useEffect, useRef } from 'react'

/** Debounce for capturing the scroll position while the user scrolls. */
const CAPTURE_DEBOUNCE_MS = 300

type PersistenceOptions = {
  isPositioning?: boolean
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
    isPositioning = false,
  }: PersistenceOptions,
) {
  const {
    metaRef,
    topPadding,
    rowsRef,
    scroller: { coordinator },
  } = deps

  const isAtBottomRef = useRef(isAtBottom)
  const onRestoreSettledRef = useRef(onRestoreSettled)
  useEffect(() => {
    isAtBottomRef.current = isAtBottom
    onRestoreSettledRef.current = onRestoreSettled
  })

  const armedRef = useRef(false)

  const capture = useCallback(() => {
    if (!armedRef.current || !sessionId) return
    if (isPositioning) return
    const windowMeta = metaRef.current
    if (windowMeta.isLoadingOlder || windowMeta.isLoadingNewer) return
    if (coordinator.kind === 'restore' || coordinator.kind === 'navigate')
      return

    const topPaddingPx = getNavPaddingPx(topPadding)
    const [anchor] = captureWindowScrollAnchor(
      document.documentElement,
      rowsRef.current,
      topPaddingPx,
      window.innerHeight,
    )
    if (!anchor) return
    const anchorId = anchor.row.messageId

    const meta = messageStore.getMessageMetadata(anchorId)
    // Whether the auto scroller is currently active
    const following =
      metaRef.current.isAtLiveTail && isAtBottomRef.current === true

    // A non-following restore needs the creation time to relocate an unloaded anchor
    if (!following && meta?._creationTime === undefined) return

    // Anchor to the row within the message
    const rowAddress = scrollRowAddress(anchor.row, messageStore)
    const offset = anchor.top - topPaddingPx
    setSavedScroll(sessionId, {
      anchorId,
      creationTime: meta?._creationTime ?? 0,
      segmentIndex: rowAddress?.segmentIndex,
      rowKey: anchor.row.key,
      rowAddress,
      contentOffset: true,
      offset,
      following,
    })
  }, [
    sessionId,
    topPadding,
    messageStore,
    metaRef,
    rowsRef,
    coordinator,
    isPositioning,
  ])

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

  // Full page reloads do not unmount React before leaving.
  useEffect(() => {
    const captureLeaving = () => captureRef.current()
    window.addEventListener('pagehide', captureLeaving)
    return () => {
      window.removeEventListener('pagehide', captureLeaving)
      captureLeaving()
    }
  }, [])

  const restored = useCallback(() => {
    scrollDebug('persistence.restored')
    armedRef.current = true
    onRestoreSettledRef.current()
  }, [])

  // Restores a saved position. Returns true if it took over scrolling.
  const restore = useCallback((): boolean => {
    const saved = sessionId ? getSavedScroll(sessionId) : undefined
    scrollDebug('persistence.restore', () => ({ saved }))
    if (!saved || saved.following) {
      armedRef.current = true
      return false
    }
    armedRef.current = false

    requestScrollToMessage(
      saved.anchorId,
      saved.creationTime,
      saved.segmentIndex,
      {
        kind: 'restore',
        onCancelled: restored,
        offset: saved.offset,
        rowKey: saved.rowKey,
        rowAddress: saved.rowAddress,
        contentOffset: saved.contentOffset,
        onSettled: restored,
        onNotFound: () => {
          followToBottom() // fall back to the bottom
          restored()
        },
      },
    )
    return true
  }, [sessionId, requestScrollToMessage, followToBottom, restored])

  return { restore }
}
