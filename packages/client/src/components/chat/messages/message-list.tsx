import { useScrollMode } from '@/hooks/chat'
import {
  useActiveSession,
  useActiveSessionStatus,
  useChatStatus,
  useMessageIds,
  useMessageRows,
  useMessageStore,
  useStreamInvokedBy,
  useStreamProcessingMessageId,
  useUserProfile,
  useWindowControls,
  useWindowMetadata,
} from '@/hooks/chat'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import { useScroller } from '@/hooks/scroller'
import type { MessageRow } from '@/lib/chat/rows'
import { isOngoingStream } from '@/lib/chat/stream'
import { trackHeightSettle, trackUntilSettled } from '@/lib/scroll-settle'
import type { ChatStatus } from 'ai'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { WindowVirtualizerHandle } from 'virtua'

import { PendingAgentRow } from '../chat-countdowns'
import { ChatScrollArea } from '../chat-scroll-area'
import { useMessageEdit } from './editor/message-edit-context'
import {
  MessageListContent,
  type MessageListContentState,
} from './message-list-content'
import { MessageListContext } from './message-list-context'
import { MessageRowView } from './message-row-view'

const LOADING_INDICATOR_DELAY_MS = 150

export type MessageListProps = Omit<React.ComponentProps<'div'>, 'ref'> & {
  ref?: React.Ref<MessageListHandle>
  innerStyle?: React.CSSProperties
  topPadding?: number
  bottomPadding?: number
  header?: React.ReactNode
  isAtBottom?: boolean
  onScrollChange?: (e?: Event) => void
  onIntoViewSettle?: () => void
}

export type MessageListHandle = {
  /** Returns to the live tail (loading it if needed) and scrolls to the bottom. */
  followToBottom: () => void
  /** Returns to the conversation start (loading it if needed) and scrolls to the top. */
  followToTop: () => void
  /** Reveals the newest message at the top of the viewport without auto-following. */
  revealLatest: () => void
  lockScroll: () => void
  scrollByPage: (direction: 1 | -1) => void
  scrollToMessage: (id: string) => void
  /** Scrolls to a message, locating it by creationTime if outside the loaded window. */
  requestScrollToMessage: (
    id: string,
    creationTime?: number,
    segmentIndex?: number,
  ) => void
}

export function MessageList({
  ref,
  className,
  innerStyle,
  topPadding,
  bottomPadding,
  header,
  isAtBottom,
  onScrollChange,
  onIntoViewSettle,
  ...rest
}: MessageListProps) {
  const messageIds = useMessageIds()
  const rows = useMessageRows()
  const messageStore = useMessageStore()
  const profile = useUserProfile()
  const status = useChatStatus()
  const invokedBy = useStreamInvokedBy()
  const processingMessageId = useStreamProcessingMessageId()

  const {
    isLoadingFirstPage,
    canLoadOlder,
    canLoadNewer,
    isAtLiveTail,
    isLoadingOlder,
    isLoadingNewer,
    isSliding,
  } = useWindowMetadata()

  const {
    extendOlder,
    extendNewer,
    returnToLatest,
    returnToOldest,
    anchorAround,
  } = useWindowControls() // prettier-ignore

  const isLocalStream = !!invokedBy && invokedBy === profile?._id

  // Whether the stream is happening earlier in the history
  const isMidListStream = useMemo(() => {
    if (!processingMessageId) return false
    const index = messageIds.indexOf(processingMessageId)
    return index >= 0 && index < messageIds.length - 1
  }, [processingMessageId, messageIds])

  const sessionStatus = useActiveSessionStatus()
  const isLoading = sessionStatus === 'loading' || isLoadingFirstPage
  const showLoadingIndicator = useDelayedVisibility(
    isLoading,
    LOADING_INDICATOR_DELAY_MS,
  )

  const scrollMode = useScrollMode()
  // Allow overriding scroll mode to follow the stream on demand
  const [followOverride, setFollowOverride] = useState(false)

  // Sub-agent sessions open with autoscrolling enabled
  const isSubagentSession = !!useActiveSession()?.parent
  const [subagentFollowReleased, setSubagentFollowReleased] = useState(false)
  const subagentFollow =
    isSubagentSession && !subagentFollowReleased && isOngoingStream(status)

  const autoScroll =
    scrollMode === 'follow' || followOverride || subagentFollow

  const isEditing = !!useMessageEdit()?.editingMessageId

  const releaseFollowOverride = useCallback(() => {
    setFollowOverride(false)
    setSubagentFollowReleased(true)
  }, [])

  const {
    scrollRef,
    sentinelRef,
    lockScroll,
    unlockScroll,
    setShiftInProgress,
    setReady,
    scrollToBottom,
    holdPosition,
    pauseFollow,
    scrollUntilCondition,
    setImmediate,
  } = useScroller({
    enabled: autoScroll && !isEditing,
    onSettle: onIntoViewSettle,
    onFollowRelease: releaseFollowOverride,
    bottomInset: bottomPadding ?? 0,
    mode: 'window',
  })

  const virtuaRef = useRef<WindowVirtualizerHandle>(null)

  const docScrollRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    docScrollRef.current = document.documentElement
  }, [])

  const rowsRef = useRef(rows)
  useLayoutEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const metaRef = useRef({
    canLoadOlder,
    canLoadNewer,
    isAtLiveTail,
    isLoadingOlder,
    isLoadingNewer,
  })
  useEffect(() => {
    metaRef.current = {
      canLoadOlder,
      canLoadNewer,
      isAtLiveTail,
      isLoadingOlder,
      isLoadingNewer,
    }
  })

  // Tracks the position of a message across a window slide so it can be restored afterwards
  const slideAnchorRef = useRef<{ id: string; top: number } | null>(null)
  const slidePendingRef = useRef(false)

  // Capture the first message still visible below the nav padding
  const captureSlideAnchor = useCallback(() => {
    const container = docScrollRef.current
    if (!container) return null
    const topPaddingPx = getNavPaddingPx(topPadding ?? 1)
    const els = container.querySelectorAll<HTMLElement>('[data-message-id]')
    for (const el of els) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > topPaddingPx) {
        const id = el.dataset.messageId
        if (id) return { id, top: rect.top }
      }
    }
    return null
  }, [topPadding])

  const loadOlder = useCallback(() => {
    const m = metaRef.current
    if (!m.canLoadOlder || m.isLoadingOlder) return
    const anchor = captureSlideAnchor()
    setShiftInProgress(true)
    if (extendOlder() && anchor) {
      slideAnchorRef.current = anchor
      slidePendingRef.current = true
    }
  }, [extendOlder, setShiftInProgress, captureSlideAnchor])

  const loadNewer = useCallback(() => {
    const m = metaRef.current
    if (!m.canLoadNewer || m.isLoadingNewer) return
    const anchor = captureSlideAnchor()
    setShiftInProgress(true)
    if (extendNewer() && anchor) {
      slideAnchorRef.current = anchor
      slidePendingRef.current = true
    }
  }, [extendNewer, setShiftInProgress, captureSlideAnchor])

  // A pending Page Up/Down continuation that slid the window
  const pendingPageRef = useRef<1 | -1 | null>(null)

  const slideRestoreRef = useRef<(() => void) | null>(null)
  // Restore the anchor to preserve the scroll position
  const restoreSlideAnchor = useCallback(() => {
    const anchor = slideAnchorRef.current
    slideAnchorRef.current = null
    if (!anchor) return

    const topPaddingPx = getNavPaddingPx(topPadding ?? 1)
    const page = pendingPageRef.current
    pendingPageRef.current = null
    const pageShift = page ? window.innerHeight * 0.9 * page : 0
    const targetTop = Math.max(topPaddingPx, anchor.top) - pageShift

    slideRestoreRef.current?.()
    // Converge on the anchor's real position
    slideRestoreRef.current = trackUntilSettled(() => {
      const index = rowsRef.current.findIndex(
        (row) => row.messageId === anchor.id,
      )
      if (index < 0) return null

      const el = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(anchor.id)}"]`,
      )
      // Bring it closer if it's not mounted yet
      if (!el) {
        virtuaRef.current?.scrollToIndex(index, {
          align: 'start',
          offset: -targetTop,
        })
        return null
      }

      const delta = el.getBoundingClientRect().top - targetTop
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta })
      return delta
    })
  }, [topPadding])
  useEffect(() => () => slideRestoreRef.current?.(), [])

  const prevSlidingRef = useRef(isSliding)
  useLayoutEffect(() => {
    const wasSliding = prevSlidingRef.current
    prevSlidingRef.current = isSliding
    if (wasSliding && !isSliding && slidePendingRef.current) {
      slidePendingRef.current = false
      restoreSlideAnchor()
    }
  }, [isSliding, restoreSlideAnchor])

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
  }, [scrollToBottom])
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
  }, [settleToBottom, status, returnToLatest])

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
  }, [settleToTop, returnToOldest])

  // Ensure the list is at the very top once the head window loads
  useEffect(() => {
    if (!pendingTopRef.current || canLoadOlder) return
    pendingTopRef.current = false
    settleToTop()
  }, [canLoadOlder, rows, settleToTop])

  const revealResolvedMessage = useCallback(
    (resolveMessageId: () => string | undefined) => {
      const topPaddingPx = getNavPaddingPx(topPadding ?? 1)
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
    [topPadding],
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
  }, [returnToLatest, revealResolvedMessage])

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

    if (isAtBottom !== true || !isAtLiveTail || !profile?._id) return

    const appendedIds = appendedMessageIds(previousIds, messageIds)
    if (appendedIds.length === 0) return

    const messageId = latestRemoteUserMessageId(
      appendedIds,
      messageStore,
      profile._id,
    )
    if (messageId) revealMessage(messageId)
  }, [
    isAtBottom,
    isAtLiveTail,
    isLoading,
    messageIds,
    messageStore,
    profile?._id,
    revealMessage,
  ])

  const growScrollRef = useRef(0)
  // Continue scrolling compensating for height recalculations (page up/down)
  const continueScrollAfterGrow = useCallback((direction: 1 | -1) => {
    cancelAnimationFrame(growScrollRef.current)
    const startHeight = document.documentElement.scrollHeight
    let frames = 0
    const tick = () => {
      if (document.documentElement.scrollHeight !== startHeight) {
        window.scrollBy({ top: window.innerHeight * 0.9 * direction })
        return
      }
      if (++frames > 40) return
      growScrollRef.current = requestAnimationFrame(tick)
    }
    growScrollRef.current = requestAnimationFrame(tick)
  }, [])
  useEffect(() => () => cancelAnimationFrame(growScrollRef.current), [])

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const doc = docScrollRef.current
      if (!doc) return

      const max = Math.max(0, doc.scrollHeight - window.innerHeight)
      const atTop = direction === -1 && window.scrollY <= 1
      const atBottom = direction === 1 && window.scrollY >= max - 1
      const m = metaRef.current

      // At a window edge, pull in the next page and keep scrolling into it
      if (atTop && m.canLoadOlder && !m.isLoadingOlder) {
        holdPosition()
        loadOlder()
        if (slidePendingRef.current) pendingPageRef.current = direction
        else continueScrollAfterGrow(direction)
        return
      }
      if (atBottom && m.canLoadNewer && !m.isLoadingNewer) {
        holdPosition()
        loadNewer()
        if (slidePendingRef.current) pendingPageRef.current = direction
        else continueScrollAfterGrow(direction)
        return
      }

      pauseFollow(direction)
      window.scrollBy({ top: window.innerHeight * 0.9 * direction })
    },
    [pauseFollow, holdPosition, loadOlder, loadNewer, continueScrollAfterGrow],
  )

  const scrollToMessage = useCallback(
    (id: string) => {
      const index = rows.findIndex((row) => row.messageId === id)
      if (index < 0) return
      virtuaRef.current?.scrollToIndex(index, {
        align: 'nearest',
        offset: -getNavPaddingPx(topPadding ?? 1),
      })
    },
    [rows, topPadding],
  )

  const pendingTargetRef = useRef<{
    id: string
    creationTime?: number
    segmentIndex?: number
    anchored: boolean
  } | null>(null)
  const [seekTick, setSeekTick] = useState(0)
  // Prepare a message scroll event
  const requestScrollToMessage = useCallback(
    (id: string, creationTime?: number, segmentIndex?: number) => {
      pendingTargetRef.current = {
        id,
        creationTime,
        segmentIndex,
        anchored: false,
      }
      holdPosition() // disable autoscroller
      setSeekTick((tick) => tick + 1)
    },
    [holdPosition],
  )

  const seekSettleRef = useRef<(() => void) | null>(null)
  // Scroll to a message until it settles below the nav padding
  const scrollToMessageSettled = useCallback(
    (id: string) => {
      seekSettleRef.current?.()
      const topPaddingPx = getNavPaddingPx(topPadding ?? 1)

      seekSettleRef.current = trackUntilSettled(() => {
        const index = rowsRef.current.findIndex((row) => row.messageId === id)
        if (index < 0) return null

        const el = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(id)}"]`,
        )
        // Bring it closer if it's not mounted yet
        if (!el) {
          virtuaRef.current?.scrollToIndex(index, {
            align: 'start',
            offset: -topPaddingPx,
          })
          return null
        }

        const delta = el.getBoundingClientRect().top - topPaddingPx
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta })
        return delta
      })
    },
    [topPadding],
  )
  useEffect(() => () => seekSettleRef.current?.(), [])

  // Keep track of the previous stream status to reset the scroll override
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev !== 'ready' && status === 'ready') setFollowOverride(false)
  }, [status])

  useImperativeHandle(
    ref,
    () => ({
      followToBottom,
      followToTop,
      revealLatest,
      lockScroll,
      scrollByPage,
      scrollToMessage,
      requestScrollToMessage,
    }),
    [
      followToBottom,
      followToTop,
      revealLatest,
      lockScroll,
      scrollByPage,
      scrollToMessage,
      requestScrollToMessage,
    ],
  )

  useEffect(() => {
    if (!onScrollChange) return
    window.addEventListener('scroll', onScrollChange, { passive: true })
    return () => window.removeEventListener('scroll', onScrollChange)
  }, [onScrollChange])

  useEffect(() => {
    onScrollChange?.()
  }, [messageIds, onScrollChange])

  // Resolve a pending scroll target, anchoring the window around it if needed
  useEffect(() => {
    const target = pendingTargetRef.current
    if (!target) return

    if (rows.some((row) => row.messageId === target.id)) {
      pendingTargetRef.current = null
      scrollToMessageSettled(target.id)
      return
    }

    if (!target.anchored && target.creationTime !== undefined) {
      target.anchored = true
      anchorAround({
        _id: target.id,
        _creationTime: target.creationTime,
        segmentIndex: target.segmentIndex,
      })
      return
    }

    if (!target.anchored) pendingTargetRef.current = null
  }, [seekTick, rows, scrollToMessageSettled, anchorAround])

  const editingId = useMessageEdit()?.editingMessageId ?? null

  // Bring the edited message into view to keep it mounted while editing
  useEffect(() => {
    if (!editingId) return

    const isMounted = Boolean(
      document.querySelector(`[data-message-id="${CSS.escape(editingId)}"]`),
    )
    if (isMounted) return

    const idx = rows.findIndex(
      (row) => row.kind === 'group' && row.messageId === editingId,
    )
    if (idx >= 0) virtuaRef.current?.scrollToIndex(idx, { align: 'nearest' })

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  useChatLifecycle(
    status,
    // Autofollow only for the user's own activity and only when already at the bottom
    isLocalStream && isAtBottom === true && isAtLiveTail && !isMidListStream,
    unlockScroll,
  )

  useConditionalScroll(
    autoScroll,
    status,
    (isLocalStream || isAtBottom === true) && isAtLiveTail && !isMidListStream,
    scrollRef,
    scrollUntilCondition,
    topPadding ?? 1,
    messageIds,
    processingMessageId ?? null,
  )

  const shiftHoldRef = useRef(false)
  useLayoutEffect(() => {
    shiftHoldRef.current = isLoadingOlder || isLoadingNewer || !!editingId
    setShiftInProgress(shiftHoldRef.current)
  }, [isLoadingOlder, isLoadingNewer, editingId, setShiftInProgress])

  const hasHeaderContainer = !!(header || canLoadOlder)

  const topPaddingStyle = useMemo(
    () => ({ paddingTop: `calc(var(--spacing)*${topPadding ?? 1})` }),
    [topPadding],
  )

  const renderRow = useCallback(
    (row: MessageRow) => <MessageRowView key={row.key} row={row} />,
    [],
  )

  const hasInitiallyScrolledRef = useRef(false)
  const initialSettleRef = useRef<(() => void) | null>(null)
  // Scroll to the bottom once the session is fully loaded
  useLayoutEffect(() => {
    if (isLoading) return
    setReady(true)
    if (!hasInitiallyScrolledRef.current && rows.length > 0) {
      hasInitiallyScrolledRef.current = true
      // Snap (never glide) while the freshly mounted list re-measures its rows
      setImmediate(true)
      virtuaRef.current?.scrollToIndex(rows.length - 1, { align: 'end' })
      initialSettleRef.current?.()
      initialSettleRef.current = trackHeightSettle(
        () => scrollToBottom(true),
        document.documentElement,
        () => setImmediate(false),
      )
    }
  }, [isLoading, setReady, rows.length, scrollToBottom, setImmediate])

  useEffect(() => () => initialSettleRef.current?.(), [])

  const settleCancelRef = useRef<(() => void) | null>(null)
  // Suppress auto-follow during layout shifts and emit scroll change when the height settles
  const onLayoutChange = useCallback(() => {
    setShiftInProgress(true)
    requestAnimationFrame(() => setShiftInProgress(shiftHoldRef.current))

    settleCancelRef.current?.()
    settleCancelRef.current = onScrollChange
      ? trackHeightSettle(onScrollChange)
      : null
  }, [setShiftInProgress, onScrollChange])

  useEffect(() => () => settleCancelRef.current?.(), [])

  const messageListCtxValue = useMemo(
    () => ({
      scrollRef: docScrollRef as React.RefObject<HTMLElement | null>,
      onLayoutChange,
      onIntoViewSettle,
      releaseFollow: holdPosition,
      resumeFollow: () => unlockScroll(true),
      bottomPadding: bottomPadding ?? 0,
      topPadding: topPadding ?? 1,
    }),
    [
      onLayoutChange,
      onIntoViewSettle,
      holdPosition,
      unlockScroll,
      bottomPadding,
      topPadding,
    ],
  )

  const contentState: MessageListContentState = isLoading
    ? 'loading'
    : messageIds.length === 0 && status === 'ready'
      ? 'empty'
      : 'messages'

  return (
    <ChatScrollArea
      data-slot="message-list"
      mode="window"
      className={className}
      scrollRef={scrollRef as React.RefObject<HTMLDivElement>}
      bottomPadding={bottomPadding}
      {...rest}
    >
      <MessageListContext.Provider value={messageListCtxValue}>
        <>
          <MessageListContent
            state={contentState}
            showLoadingIndicator={showLoadingIndicator}
            emptyStyle={innerStyle}
            messages={{
              rows,
              hasHeaderContainer,
              innerStyle,
              topPadding,
              topPaddingStyle,
              header,
              hasMore: canLoadOlder,
              hasNewer: canLoadNewer,
              shiftItems: isLoadingOlder && !isSliding,
              onLoadMore: loadOlder,
              onLoadNewer: loadNewer,
              renderRow,
              virtuaRef,
            }}
          />
          {contentState === 'messages' && (
            <div className="mx-auto" style={innerStyle}>
              <PendingAgentRow />
            </div>
          )}
          <div ref={sentinelRef} className="h-20 w-full shrink-0" />
        </>
      </MessageListContext.Provider>
    </ChatScrollArea>
  )
}

function useDelayedVisibility(visible: boolean, delay: number) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setIsVisible(visible),
      visible ? delay : 0,
    )
    return () => window.clearTimeout(timeoutId)
  }, [delay, visible])

  return isVisible
}

function appendedMessageIds(previous: string[], current: string[]): string[] {
  if (current.length <= previous.length) return []
  for (let index = 0; index < previous.length; index++) {
    if (previous[index] !== current[index]) return []
  }
  return current.slice(previous.length)
}

function latestRemoteUserMessageId(
  ids: string[],
  store: ReturnType<typeof useMessageStore>,
  localUserId: string,
): string | null {
  for (let index = ids.length - 1; index >= 0; index--) {
    const id = ids[index]
    const message = store.getMessage(id)
    const metadata = store.getMessageMetadata(id)

    if (
      message?.role === 'user' &&
      metadata?.sender.type === 'user' &&
      metadata.sender.id !== localUserId
    ) {
      return id
    }
  }

  return null
}

function firstMessageRowIndex(rows: MessageRow[], messageId: string): number {
  return rows.findIndex((row) => row.messageId === messageId)
}

function useChatLifecycle(
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

function useConditionalScroll(
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
