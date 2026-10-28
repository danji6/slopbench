import { hydrateLiveSegments } from '@/lib/chat/live-segments'
import type {
  MessageWindowMetadata,
  WindowAnchor,
  WindowBoundary,
  WindowControls,
} from '@/lib/chat/message-store'
import {
  anchorForOlderPage,
  anchorFromStart,
  sliceTailByBudget,
} from '@/lib/chat/window-math'
import { scrollDebug } from '@/lib/scroll-debug'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import {
  MESSAGE_PAGE_BUDGET_BYTES,
  MESSAGE_WINDOW_BUDGET_BYTES,
  MESSAGE_WINDOW_MAX_ROWS,
} from '@sb/core/const'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type WindowResult = FunctionReturnType<typeof api.chat.messagesWindow>
type AnchorKey = (string | number)[]

type WindowState =
  | {
      kind: 'live'
      capBytes: number
      session: Id<'sessions'> | null
    }
  | {
      kind: 'head'
      session: Id<'sessions'> | null
    }
  | {
      kind: 'older'
      anchor: AnchorKey
      anchorSegment?: number
      anchorInclusive?: boolean
      session: Id<'sessions'> | null
    }
  | {
      kind: 'newer'
      anchor: AnchorKey
      anchorSegment?: number
      session: Id<'sessions'> | null
      viaSeek: boolean
    }

export type MessageWindow = {
  messages: WindowResult['page']
  meta: MessageWindowMetadata
  controls: WindowControls
  /** Bumped on deliberate jumps to drop retained messages. */
  resetKey: number
}

/**
 * A reactive window over a session's messages, gated by serialized
 * content size. Grows when the user requests older messages, and
 * shrinks when they jump back to the bottom.
 */
export function useMessageWindow(
  sessionId: Id<'sessions'> | null,
): MessageWindow {
  const [state, setState] = useState<WindowState>({
    kind: 'live',
    capBytes: MESSAGE_PAGE_BUDGET_BYTES,
    session: sessionId,
  })
  const [loading, setLoading] = useState<{
    dir: 'older' | 'newer'
    slide: boolean
    revision: number
  } | null>(null)
  const requestRevision = useRef(0)
  const [pageRevision, setPageRevision] = useState(0)
  const startLoading = useCallback((dir: 'older' | 'newer', slide: boolean) => {
    setLoading({ dir, slide, revision: ++requestRevision.current })
  }, [])
  // Incremented on deliberate jumps so the store discards retained messages
  const [resetKey, setResetKey] = useState(0)

  // Reset to the live tail when the active session changes
  if (state.session !== sessionId) {
    setState({
      kind: 'live',
      capBytes: MESSAGE_PAGE_BUDGET_BYTES,
      session: sessionId,
    })
    setLoading(null)
  }

  const args = useMemo(() => {
    if (!sessionId || state.session !== sessionId) return 'skip' as const
    if (state.kind === 'live') {
      return {
        sessionId,
        anchor: null,
        direction: 'older' as const,
        limit: MESSAGE_WINDOW_MAX_ROWS,
        budgetBytes: state.capBytes,
      }
    }
    if (state.kind === 'head') {
      return {
        sessionId,
        anchor: null,
        direction: 'newer' as const,
        limit: MESSAGE_WINDOW_MAX_ROWS,
        budgetBytes: MESSAGE_WINDOW_BUDGET_BYTES,
      }
    }
    return {
      sessionId,
      anchor: state.anchor,
      anchorSegment: state.anchorSegment,
      anchorInclusive:
        state.kind === 'older' ? state.anchorInclusive : undefined,
      direction:
        state.kind === 'older' ? ('older' as const) : ('newer' as const),
      limit: MESSAGE_WINDOW_MAX_ROWS,
      budgetBytes: MESSAGE_WINDOW_BUDGET_BYTES,
    }
  }, [sessionId, state])

  const result = useQuery(api.chat.messagesWindow, args)
  const liveSegments = useQuery(
    api.chat.processingMessageSegments,
    sessionId ? { sessionId } : 'skip',
  )

  const [held, setHeld] = useState<{
    session: Id<'sessions'> | null
    data: WindowResult
  } | null>(null)

  // Hold the last result to avoid empty window slides
  if (result !== undefined && held?.data !== result) {
    setHeld({ session: sessionId, data: result })
  }
  const data = result ?? (held?.session === sessionId ? held.data : null)

  // Clear the loading flag one frame after fresh data lands
  useEffect(() => {
    if (result === undefined || !loading) return
    const id = requestAnimationFrame(() => {
      setPageRevision(loading.revision)
      setLoading(null)
    })
    return () => cancelAnimationFrame(id)
  }, [result, loading])

  // Switch to live when the user walks forward to the tail. Skipped
  // when viaSeek is true.
  useEffect(() => {
    if (state.kind !== 'newer' || state.viaSeek || !data?.atTail) return
    const id = requestAnimationFrame(() =>
      setState({
        kind: 'live',
        capBytes: MESSAGE_WINDOW_BUDGET_BYTES,
        session: sessionId,
      }),
    )
    return () => cancelAnimationFrame(id)
  }, [state, data?.atTail, sessionId])

  const messages = useMemo(() => {
    const page = data?.page
    if (!page) return []
    const sliced =
      state.kind === 'live' ? sliceTailByBudget(page, state.capBytes) : page
    return hydrateLiveSegments(sliced, liveSegments ?? [])
  }, [data, state, liveSegments])

  useEffect(() => {
    if (result === undefined || loading) return
    scrollDebug('window.result', () => ({
      kind: state.kind,
      args,
      pageRevision,
      count: messages.length,
      bytes: messages.reduce((total, message) => total + message.sizeBytes, 0),
      hasOlder: data?.hasOlder,
      hasNewer: data?.hasNewer,
      atTail: data?.atTail,
      first: debugBoundary(messages[0]),
      last: debugBoundary(messages.at(-1)),
    }))
  }, [state.kind, args, result, loading, pageRevision, messages, data])

  const keyOf = useCallback(
    (msg: WindowAnchor): AnchorKey | null =>
      sessionId ? [sessionId, msg._creationTime, msg._id] : null,
    [sessionId],
  )

  // Load older messages while dropping the newest page.
  // Returns true if the window swapped its content.
  const extendOlder = useCallback(
    (before?: WindowBoundary): boolean => {
      if (!sessionId || loading) return false
      if (!before && state.kind === 'live') {
        const capBytes = state.capBytes + MESSAGE_PAGE_BUDGET_BYTES
        // Grow the live window until it hits the full budget, then fall
        // through to anchored mode to start trimming
        if (capBytes <= MESSAGE_WINDOW_BUDGET_BYTES) {
          startLoading('older', false)
          setState({ kind: 'live', capBytes, session: sessionId })
          return false
        }
      }

      if (messages.length === 0) return false

      const target = anchorForOlderPage(
        messages,
        MESSAGE_PAGE_BUDGET_BYTES,
        MESSAGE_WINDOW_BUDGET_BYTES,
      )
      const anchor = keyOf(before ?? messages[target.index])
      if (!anchor) return false

      startLoading('older', true)
      setState({
        kind: 'older',
        anchor,
        anchorSegment: before
          ? before.hasOlderSegments
            ? before.segmentIndex - 1
            : undefined
          : target.segmentIndex,
        anchorInclusive: before ? before.hasOlderSegments : true,
        session: sessionId,
      })
      return true
    },
    [sessionId, state, messages, keyOf, loading, startLoading],
  )

  // Load newer messages while dropping the oldest page
  const extendNewer = useCallback((): boolean => {
    if (!sessionId || messages.length === 0) return false

    const target = anchorFromStart(messages, MESSAGE_PAGE_BUDGET_BYTES)
    const anchor = keyOf(messages[target.index])
    if (!anchor) return false

    startLoading('newer', true)
    setState({
      kind: 'newer',
      anchor,
      anchorSegment: target.segmentIndex,
      session: sessionId,
      viaSeek: false,
    })
    return true
  }, [sessionId, messages, keyOf, startLoading])

  const returnToLatest = useCallback(() => {
    if (!sessionId) return
    setLoading(null)
    setResetKey((key) => key + 1)
    setState({
      kind: 'live',
      capBytes: MESSAGE_PAGE_BUDGET_BYTES,
      session: sessionId,
    })
  }, [sessionId])

  const returnToOldest = useCallback(() => {
    if (!sessionId) return
    setLoading(null)
    setResetKey((key) => key + 1)
    setState({ kind: 'head', session: sessionId })
  }, [sessionId])

  // Show the target at the top with the conversation continuing below it
  const anchorAround = useCallback(
    (anchorMsg: WindowAnchor) => {
      if (!sessionId) return
      const anchor = keyOf(anchorMsg)
      if (!anchor) return
      setLoading(null)
      setResetKey((key) => key + 1)
      setState({
        kind: 'newer',
        anchor,
        anchorSegment: anchorMsg.segmentIndex,
        session: sessionId,
        viaSeek: true,
      })
    },
    [sessionId, keyOf],
  )

  const controls = useMemo<WindowControls>(
    () => ({
      extendOlder,
      extendNewer,
      returnToLatest,
      returnToOldest,
      anchorAround,
    }),
    [extendOlder, extendNewer, returnToLatest, returnToOldest, anchorAround],
  )

  const meta = useMemo<MessageWindowMetadata>(
    () => ({
      pageRevision,
      navigationRevision: resetKey,
      isLoadingFirstPage: data === null,
      canLoadOlder: data?.hasOlder ?? false,
      canLoadNewer: data?.hasNewer ?? false,
      isAtLiveTail: state.kind === 'live' || (data?.atTail ?? false),
      isLoadingOlder: loading?.dir === 'older',
      isLoadingNewer: loading?.dir === 'newer',
      isSliding: loading?.slide ?? false,
    }),
    [data, state.kind, loading, pageRevision, resetKey],
  )

  return { messages, meta, controls, resetKey }
}

function debugBoundary(message: WindowResult['page'][number] | undefined) {
  if (!message) return
  return {
    id: message._id,
    version: message.selectedVersion,
    bytes: message.sizeBytes,
    firstSegment: message.segments[0]?.segmentIndex,
    lastSegment: message.segments.at(-1)?.segmentIndex,
    hasOlderSegments: message.hasOlderSegments,
    hasNewerSegments: message.hasNewerSegments,
  }
}
