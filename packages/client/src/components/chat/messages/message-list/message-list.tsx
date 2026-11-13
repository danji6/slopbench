import { useScrollMode } from '@/hooks/chat'
import {
  useActiveSession,
  useActiveSessionStatus,
  useChatStatus,
  useMessageIds,
  useMessageRows,
  useMessageStore,
  useRunningShellSender,
  useStreamInvokedBy,
  useStreamProcessingMessageId,
  useUserProfile,
  useWindowControls,
  useWindowMetadata,
} from '@/hooks/chat'
import { useDelayedVisibility } from '@/hooks/chat/message-list/delayed-visibility'
import { useFollowEdges } from '@/hooks/chat/message-list/follow-edges'
import { useInitialPosition } from '@/hooks/chat/message-list/initial-position'
import { useMessageReveal } from '@/hooks/chat/message-list/message-reveal'
import { usePageScroll } from '@/hooks/chat/message-list/page-scroll'
import { useScrollPersistence } from '@/hooks/chat/message-list/scroll-persistence'
import { useSeek } from '@/hooks/chat/message-list/seek'
import {
  useConditionalFollow,
  useConditionalScroll,
} from '@/hooks/chat/message-list/stream-reveal'
import { useVersionCrossfade } from '@/hooks/chat/message-list/version-crossfade'
import { useVersionHold } from '@/hooks/chat/message-list/version-hold'
import { useWindowSlide } from '@/hooks/chat/message-list/window-slide'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import { useScroller } from '@/hooks/scroller'
import type { MessageRow } from '@/lib/chat/rows'
import { isOngoingStream } from '@/lib/chat/stream'
import {
  useCallback,
  useEffect,
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
import { MessageListContent } from './message-list-content'
import {
  type FinishComposerReveal,
  MessageListContext,
} from './message-list-context'
import {
  type MessageListHandle,
  useMessageListHandle,
} from './message-list-handle'

export type { MessageListHandle } from './message-list-handle'

const LOADING_INDICATOR_DELAY_MS = 150

/** Failsafe in case a scroll restore never settles. */
const REVEAL_TIMEOUT_MS = 5000

export type MessageListProps = Omit<React.ComponentProps<'div'>, 'ref'> & {
  ref?: React.Ref<MessageListHandle>
  innerStyle?: React.CSSProperties
  topPadding?: number
  bottomPadding?: number
  /** Extra dock padding that should be ignored for sticky bottom state. */
  extraBottomInset?: number
  header?: React.ReactNode
  isAtBottom?: boolean
  onScrollChange?: (
    event?: Event,
    autoScrolling?: boolean,
    extraBottomInset?: number,
  ) => void
  onIntoViewSettle?: () => void
  onInitialPositionSettled?: () => void
  onTranscriptNavigate?: () => void
  holdComposerForReveal?: () => FinishComposerReveal | undefined
  shellFocusBlocked?: boolean
  restoreComposerFocus?: (input: HTMLElement) => void
}

export function MessageList({
  ref,
  className,
  innerStyle,
  topPadding,
  bottomPadding,
  extraBottomInset,
  header,
  isAtBottom,
  onScrollChange,
  onIntoViewSettle,
  onInitialPositionSettled,
  onTranscriptNavigate,
  holdComposerForReveal,
  shellFocusBlocked,
  restoreComposerFocus,
  ...rest
}: MessageListProps) {
  const messageIds = useMessageIds()
  const rows = useMessageRows()
  const messageStore = useMessageStore()
  const profile = useUserProfile()
  const status = useChatStatus()
  const invokedBy = useStreamInvokedBy()
  const processingMessageId = useStreamProcessingMessageId()

  const windowMeta = useWindowMetadata()
  const {
    isLoadingFirstPage,
    canLoadOlder,
    canLoadNewer,
    isAtLiveTail,
    isLoadingNewer,
    isSliding: slidingPage,
  } = windowMeta // prettier-ignore

  const {
    extendOlder,
    extendNewer,
    returnToLatest,
    returnToOldest,
    anchorAround,
  } = useWindowControls() // prettier-ignore

  const shellSender = useRunningShellSender()
  const activityMessageId =
    processingMessageId ?? (shellSender !== null ? messageIds.at(-1) : null)
  const visibleActivityMessageId =
    activityMessageId && messageIds.includes(activityMessageId)
      ? activityMessageId
      : null

  const isLocalActivity =
    (!!invokedBy && invokedBy === profile?._id) ||
    (!!shellSender && shellSender === profile?._id)

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
  const revealedRef = useRef(false)
  const markRevealed = useCallback(() => {
    if (revealedRef.current) return
    revealedRef.current = true
    setRevealed(true)
    onInitialPositionSettled?.()
  }, [onInitialPositionSettled])

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

  const releaseAfterLayout = useRef(false)
  const reportScroll = useCallback(
    (event?: Event, autoScrolling = false) => {
      if (releaseAfterLayout.current) {
        releaseAfterLayout.current = false
        onIntoViewSettle?.()
      }
      onScrollChange?.(event, autoScrolling, extraBottomInset)
    },
    [extraBottomInset, onIntoViewSettle, onScrollChange],
  )
  const handlePositionChange = useCallback(
    (autoScrolling: boolean) => reportScroll(undefined, autoScrolling),
    [reportScroll],
  )

  const scroller = useScroller({
    enabled: autoScroll && !isEditing,
    editing: isEditing,
    onSettle: onIntoViewSettle,
    onFollowRelease: releaseFollowOverride,
    onPositionChange: handlePositionChange,
    bottomInset: bottomPadding ?? 0,
    mode: 'window',
  })
  const {
    coordinator,
    scrollRef,
    sentinelRef,
    lockScroll,
    unlockScroll,
    setShiftInProgress,
    holdPosition,
    holdLayoutPosition,
    scrollUntilCondition,
    isAutoScrolling,
  } = scroller

  const handleIntoViewSettle = useCallback(() => {
    // Keep explicit releases from hiding the dock in the middle of a hold.
    if (coordinator.kind === 'layout') releaseAfterLayout.current = true
    else onIntoViewSettle?.()
  }, [coordinator, onIntoViewSettle])

  useLayoutEffect(() => {
    coordinator.resumeFollow()
    return () => coordinator.cancel()
  }, [coordinator, sessionId])

  const handleScrollChange = useCallback(
    (event?: Event) => {
      if (coordinator.kind !== 'layout') reportScroll(event, isAutoScrolling())
    },
    [coordinator, reportScroll, isAutoScrolling],
  )

  const virtuaRef = useRef<WindowVirtualizerHandle>(null)

  const docScrollRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    docScrollRef.current = document.documentElement
  }, [])

  const rowsRef = useRef(rows)
  useLayoutEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const metaRef = useRef<WindowMeta>(windowMeta)

  const topPad = topPadding ?? 1
  const deps: ScrollDeps = {
    scroller,
    virtuaRef,
    rowsRef,
    metaRef,
    docScrollRef,
    topPadding: topPad,
  }

  const slide = useWindowSlide(deps, {
    extendOlder,
    extendNewer,
    isSliding: slidingPage,
    older: { sessionId, rows, store: messageStore, meta: windowMeta },
  })
  const { loadOlder, loadNewer, isLoadingOlder } = slide
  useLayoutEffect(() => {
    metaRef.current = { ...windowMeta, isLoadingOlder }
  })

  const { followToBottom, followToTop } = useFollowEdges(deps, {
    returnToLatest,
    returnToOldest,
    status,
    isAtLiveTail,
    canLoadOlder,
    rows,
    setFollowOverride,
  })

  const { revealSentMessage } = useMessageReveal(deps, {
    returnToLatest,
    messageIds,
    messageStore,
    profileId: profile?._id,
    isLoading,
    isAtBottom,
    isAtLiveTail,
  })

  const handleSentMessage = useCallback<MessageListHandle['revealSentMessage']>(
    (id, { intoView = false } = {}) => {
      if (autoScroll && !intoView) followToBottom({ preserveHistory: true })
      else revealSentMessage(id)
    },
    [autoScroll, followToBottom, revealSentMessage],
  )

  const { scrollByPage } = usePageScroll(deps, slide)

  const { scrollToMessage, requestScrollToMessage } = useSeek(deps, {
    anchorAround,
    rows,
    messageStore,
  })

  const { restore: restoreScroll } = useScrollPersistence(deps, {
    sessionId,
    messageStore,
    isAtBottom,
    requestScrollToMessage,
    followToBottom,
    onRestoreSettled: markRevealed,
    isPositioning: slide.isPositioning,
  })

  // Keep track of the previous stream status to reset the scroll override
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev !== 'ready' && status === 'ready') setFollowOverride(false)
  }, [status])

  useMessageListHandle(
    ref,
    {
      followToBottom,
      followToTop,
      revealSentMessage: handleSentMessage,
      lockScroll,
      scrollByPage,
      scrollToMessage,
      requestScrollToMessage,
    },
    onTranscriptNavigate,
  )

  useEffect(() => {
    if (!onScrollChange) return
    window.addEventListener('scroll', handleScrollChange, { passive: true })
    window.addEventListener('resize', handleScrollChange, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScrollChange)
      window.removeEventListener('resize', handleScrollChange)
    }
  }, [onScrollChange, handleScrollChange])

  useEffect(() => {
    handleScrollChange()
  }, [messageIds, handleScrollChange])

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

  const shouldRevealStream =
    isAtBottom === true && isAtLiveTail && !isMidListStream

  useConditionalFollow(
    visibleActivityMessageId,
    isLocalActivity && shouldRevealStream,
    unlockScroll,
  )

  useConditionalScroll({
    autoScroll,
    messageId: visibleActivityMessageId,
    shouldRevealStream,
    scrollRef,
    scrollUntilCondition,
    topPadding: topPad,
  })

  useLayoutEffect(() => {
    const shiftInProgress =
      isLoadingOlder || isLoadingNewer || slide.isPositioning || !!editingId
    setShiftInProgress(shiftInProgress)
  }, [
    isLoadingOlder,
    isLoadingNewer,
    slide.isPositioning,
    editingId,
    setShiftInProgress,
  ])

  const hasHeaderContainer = !!(header || canLoadOlder)

  const topPaddingStyle = useMemo(
    () => ({ paddingTop: `calc(var(--spacing)*${topPad})` }),
    [topPad],
  )

  const renderRow = useCallback(
    (row: MessageRow) => <MessageRowView key={row.key} row={row} />,
    [],
  )

  useInitialPosition(deps, {
    isLoading,
    rowCount: rows.length,
    restoreScroll,
    markRevealed,
  })

  useLayoutEffect(() => {
    if (isEmpty) markRevealed()
  }, [isEmpty, markRevealed])

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

  const holdLocalComposer = useCallback(
    (messageId: string) => {
      const sender = messageStore.getMessageMetadata(messageId)?.sender
      if (sender?.type === 'user' && sender.id === profile?._id) {
        return holdComposerForReveal?.()
      }
    },
    [holdComposerForReveal, messageStore, profile?._id],
  )

  const messageListCtxValue = useMemo(
    () => ({
      scrollRef: docScrollRef as React.RefObject<HTMLElement | null>,
      scrollCoordinator: coordinator,
      onLayoutChange: holdLayoutPosition,
      onIntoViewSettle: handleIntoViewSettle,
      releaseFollow: holdPosition,
      resumeFollow: () => unlockScroll(true),
      trackPendingLayout: coordinator.trackPendingLayout,
      holdComposerForReveal: holdLocalComposer,
      shellFocusBlocked,
      restoreComposerFocus,
      bottomPadding: bottomPadding ?? 0,
      topPadding: topPad,
    }),
    [
      holdLayoutPosition,
      handleIntoViewSettle,
      holdPosition,
      unlockScroll,
      coordinator,
      holdLocalComposer,
      shellFocusBlocked,
      restoreComposerFocus,
      bottomPadding,
      topPad,
    ],
  )

  const overlayInset = useMemo(
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
            overlayInset={overlayInset}
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
              isLoadingOlder,
              shiftItems: false,
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
