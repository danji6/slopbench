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
import { trackHeightSettle } from '@/lib/scroll-settle'
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

import { PendingAgentRow } from '../../chat-countdowns'
import { ChatScrollArea } from '../../chat-scroll-area'
import { useMessageEdit } from '../editor/message-edit-context'
import { MessageRowView } from '../message-row-view'
import type { ScrollDeps, WindowMeta } from './deps'
import { useDelayedVisibility } from './hooks/delayed-visibility'
import { useFollowEdges } from './hooks/follow-edges'
import { useMessageReveal } from './hooks/message-reveal'
import { usePageScroll } from './hooks/page-scroll'
import { useScrollPersistence } from './hooks/scroll-persistence'
import { type SeekTargetOptions, useSeek } from './hooks/seek'
import {
  useConditionalFollow,
  useConditionalScroll,
} from './hooks/stream-reveal'
import { useVersionCrossfade } from './hooks/version-crossfade'
import { useVersionHold } from './hooks/version-hold'
import { useWindowSlide } from './hooks/window-slide'
import { MessageListContent } from './message-list-content'
import { MessageListContext } from './message-list-context'

const LOADING_INDICATOR_DELAY_MS = 150

/** Failsafe in case a scroll restore never settles. */
const REVEAL_TIMEOUT_MS = 5000

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
    options?: SeekTargetOptions,
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
  } = useWindowMetadata() // prettier-ignore

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
  const isEmpty = !isLoading && messageIds.length === 0 && status === 'ready'

  // The list stays hidden behind the loading phase until its initial scroll
  // position has settled
  const [revealed, setRevealed] = useState(false)
  const markRevealed = useCallback(() => setRevealed(true), [])

  const showLoadingIndicator = useDelayedVisibility(
    !revealed && !isEmpty,
    LOADING_INDICATOR_DELAY_MS,
  )

  const scrollMode = useScrollMode()
  // Allow overriding scroll mode to follow the stream on demand
  const [followOverride, setFollowOverride] = useState(false)

  // Sub-agent sessions open with autoscrolling enabled
  const activeSession = useActiveSession()
  const sessionId = activeSession?._id
  const isSubagentSession = !!activeSession?.parent
  const [subagentFollowReleased, setSubagentFollowReleased] = useState(false)
  const subagentFollow =
    isSubagentSession && !subagentFollowReleased && isOngoingStream(status)

  const autoScroll = scrollMode === 'follow' || followOverride || subagentFollow

  const isEditing = !!useMessageEdit()?.editingMessageId

  const releaseFollowOverride = useCallback(() => {
    setFollowOverride(false)
    setSubagentFollowReleased(true)
  }, [])

  const scroller = useScroller({
    enabled: autoScroll && !isEditing,
    onSettle: onIntoViewSettle,
    onFollowRelease: releaseFollowOverride,
    bottomInset: bottomPadding ?? 0,
    mode: 'window',
  })
  const {
    scrollRef,
    sentinelRef,
    lockScroll,
    unlockScroll,
    setShiftInProgress,
    setReady,
    scrollToBottom,
    holdPosition,
    scrollUntilCondition,
    setImmediate,
  } = scroller

  const virtuaRef = useRef<WindowVirtualizerHandle>(null)

  const docScrollRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    docScrollRef.current = document.documentElement
  }, [])

  const rowsRef = useRef(rows)
  useLayoutEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const metaRef = useRef<WindowMeta>({
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

  const topPad = topPadding ?? 1
  const deps: ScrollDeps = {
    scroller,
    virtuaRef,
    rowsRef,
    metaRef,
    docScrollRef,
    topPadding: topPad,
  }

  const slide = useWindowSlide(deps, { extendOlder, extendNewer, isSliding })
  const { loadOlder, loadNewer } = slide

  const { followToBottom, followToTop } = useFollowEdges(deps, {
    returnToLatest,
    returnToOldest,
    status,
    isAtLiveTail,
    canLoadOlder,
    rows,
    setFollowOverride,
  })

  const { revealLatest } = useMessageReveal(deps, {
    returnToLatest,
    messageIds,
    messageStore,
    profileId: profile?._id,
    isLoading,
    isAtBottom,
    isAtLiveTail,
  })

  const { scrollByPage } = usePageScroll(deps, slide)

  const { scrollToMessage, requestScrollToMessage } = useSeek(deps, {
    anchorAround,
    rows,
  })

  const { restore: restoreScroll } = useScrollPersistence(deps, {
    sessionId,
    messageStore,
    isAtBottom,
    requestScrollToMessage,
    followToBottom,
    onRestoreSettled: markRevealed,
  })

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

  useConditionalFollow(
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
    topPad,
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
    () => ({ paddingTop: `calc(var(--spacing)*${topPad})` }),
    [topPad],
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
      // Attempt scroll restore
      if (restoreScroll()) return
      // Snap immediately while the freshly mounted list re-measures its rows
      setImmediate(true)
      virtuaRef.current?.scrollToIndex(rows.length - 1, { align: 'end' })
      initialSettleRef.current?.()
      initialSettleRef.current = trackHeightSettle(
        () => scrollToBottom(true),
        document.documentElement,
        () => setImmediate(false),
      )
      // Reveal on the next frame
      requestAnimationFrame(markRevealed)
    }
  }, [
    isLoading,
    setReady,
    rows.length,
    scrollToBottom,
    setImmediate,
    restoreScroll,
    markRevealed,
  ])

  useEffect(() => () => initialSettleRef.current?.(), [])

  // Never leave the list hidden if a restore never settles
  useEffect(() => {
    if (revealed) return
    const timer = setTimeout(markRevealed, REVEAL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [revealed, markRevealed])

  // Hold the scroll position while a turn's version is switched
  useVersionHold(deps, { messageIds, messageStore, autoScroll, status })
  // Fade the swapped content for a smoother transition
  useVersionCrossfade(messageIds, messageStore)

  const settleCancelRef = useRef<(() => void) | null>(null)
  // Suppress auto-follow during layout shifts and emit scroll change when the
  // height settles
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
      topPadding: topPad,
    }),
    [
      onLayoutChange,
      onIntoViewSettle,
      holdPosition,
      unlockScroll,
      bottomPadding,
      topPad,
    ],
  )

  const overlayStyle = useMemo(
    () => ({ top: getNavPaddingPx(topPad), bottom: bottomPadding ?? 0 }),
    [topPad, bottomPadding],
  )

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
            revealed={revealed}
            isEmpty={isEmpty}
            showLoadingIndicator={showLoadingIndicator}
            overlayStyle={overlayStyle}
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
          {revealed && !isEmpty && (
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
