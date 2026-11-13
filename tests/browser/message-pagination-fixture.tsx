import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { MessageListContent } from '@/components/chat/messages/message-list/message-list-content'
import '@/globals.css'
import { useInitialPosition } from '@/hooks/chat/message-list/initial-position'
import { usePageScroll } from '@/hooks/chat/message-list/page-scroll'
import { useScrollPersistence } from '@/hooks/chat/message-list/scroll-persistence'
import { useSeek } from '@/hooks/chat/message-list/seek'
import { useWindowSlide } from '@/hooks/chat/message-list/window-slide'
import {
  type MessageWindow,
  useMessageWindow,
} from '@/hooks/chat/message-window'
import { useScroller } from '@/hooks/scroller'
import { type MessageStore, createMessageStore } from '@/lib/chat/message-store'
import { convertMessages } from '@/lib/chat/messages'
import { type MessageRow, segmentGroupsFor } from '@/lib/chat/rows'
import { projectWorkRows } from '@/lib/chat/work-rows'
import { workExpansion } from '@/lib/chat/work-state'
import { trackHeightSettle } from '@/lib/scroll-settle'
import type { Id } from '@cv/convex/_generated/dataModel'
import type { WindowMessage } from '@cv/convex/model/chat/queries'
import { MESSAGE_SPLIT_BUDGET_BYTES } from '@cv/core/const'
import { ConvexProvider } from 'convex/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { WindowVirtualizerHandle } from 'virtua'
import { messageWindowClient } from '~/tests/helpers/message-window-client'

import { clampedWindow } from './message-pagination-clamp-history'

const unit = MESSAGE_SPLIT_BUDGET_BYTES
const long = new URLSearchParams(location.search).has('long')
const withText = new URLSearchParams(location.search).has('text')
const grouped = new URLSearchParams(location.search).has('grouped')
const persist = new URLSearchParams(location.search).has('persist')
const middle = new URLSearchParams(location.search).has('middle')
const clamped = new URLSearchParams(location.search).has('clamped')

function message(time: number, segments = 1): WindowMessage {
  const loaded = Array.from({ length: segments }, (_, segmentIndex) => ({
    segmentIndex,
    sizeBytes: unit,
    parts:
      time === 0 || time === 13 || (segments > 1 && segmentIndex === 0)
        ? [
            {
              type: 'text',
              text:
                time === 13
                  ? 'Existing visible message'
                  : 'Older visible message',
            },
          ]
        : [
            {
              type: 'tool-read_file',
              toolCallId: `call${time}:${segmentIndex}`,
              state: 'output-available',
              input: { path: 'a.ts' },
              output: 'contents',
            },
          ],
  }))
  return {
    _id: `m${time}`,
    _creationTime: time,
    sessionId: 'pagination',
    role: 'assistant',
    sender: { type: 'agent', id: `agent${time}` },
    status: 'done',
    selectedVersion: 1,
    versionCount: 1,
    segments: loaded,
    sizeBytes: segments * unit,
    hasOlderSegments: false,
    hasNewerSegments: false,
  } as WindowMessage
}

const history = Array.from({ length: 14 }, (_, time) => message(time))
const readClampedWindow = clampedWindow(
  message,
  new URLSearchParams(location.search).has('full'),
)
const short = message(1, middle ? 60 : persist ? 20 : 6)
const lastSegment = short.segments.length - 1
if (withText) {
  short.segments[middle ? 40 : persist ? 14 : 4].parts = [
    { type: 'text', text: 'Original visible text before loading' },
  ]
}
if (middle) {
  short.segments[45].parts = [{ type: 'text', text: 'Tall retained message' }]
}
const source = messageWindowClient((args) => {
  if (clamped) return readClampedWindow(args)
  const count = Math.floor(args.budgetBytes! / unit)
  if (grouped) {
    const page = [message(0), message(1)].map((message) => ({
      ...message,
      sender: { type: 'agent' as const, id: 'same-agent' as Id<'agents'> },
      sizeBytes: 2 * unit,
      segments: [
        {
          segmentIndex: 0,
          sizeBytes: 2 * unit,
          parts: [
            {
              type: 'text' as const,
              text:
                message._creationTime === 0
                  ? 'Older visible message'
                  : 'Original visible text before loading',
            },
          ],
        },
      ],
    }))
    return {
      page: count > 2 ? page : page.slice(1),
      hasOlder: count <= 2,
      hasNewer: false,
      atTail: true,
    }
  }
  if (long) {
    const end =
      Number(args.anchor?.[1] ?? 13) - (args.anchorInclusive === false ? 1 : 0)
    const start = Math.max(0, end - count + 1)
    return {
      page: history.slice(start, end + 1),
      hasOlder: start > 0,
      hasNewer: end < 13,
      atTail: end === 13,
    }
  }
  const forward = args.direction === 'newer'
  const end = forward
    ? Math.min(lastSegment, (args.anchorSegment ?? 0) + count - 1)
    : (args.anchorSegment ?? lastSegment)
  const start = forward
    ? (args.anchorSegment ?? 0)
    : Math.max(0, end - count + 1)
  const segments = short.segments.slice(start, end + 1)
  return {
    page: [
      {
        ...short,
        segments,
        sizeBytes: segments.length * unit,
        hasOlderSegments: start > 0,
        hasNewerSegments: end < lastSegment,
      },
    ],
    hasOlder: true,
    hasNewer: end < lastSegment,
    atTail: end === lastSegment,
  }
})

function Row({ row, store }: { row: MessageRow; store: MessageStore }) {
  const message = store.getMessage(row.messageId)!
  if (row.kind === 'work')
    return (
      <button
        className="h-12"
        data-work-anchor={row.work.toolCallIds[0]}
        onClick={() => workExpansion.setOpen(row.work.id, true)}
      >
        Read {row.work.toolCallIds.length} files
      </button>
    )
  if (row.kind === 'header') return <p className="h-8">Agent {row.messageId}</p>
  if (row.kind !== 'group') return null
  const group = segmentGroupsFor(
    message,
    store.getMessageMetadata(row.messageId),
  ).find((slice) => slice.segmentIndex === row.segmentIndex)!.groups[
    row.groupIndex
  ]
  return (
    <article
      style={{
        height: clamped
          ? Number(row.messageId.slice(1)) < 8
            ? 1000
            : 140
          : middle && row.segmentIndex === 45
            ? 2000
            : 96,
      }}
    >
      {group.type === 'single' && group.part.type === 'text'
        ? group.part.text
        : 'Expanded tool'}
    </article>
  )
}

function Transcript({
  window,
  store,
}: {
  window: MessageWindow
  store: MessageStore
}) {
  const rawRows = useSyncExternalStore(store.subscribe, store.getRows)
  const open = useSyncExternalStore(
    workExpansion.subscribe,
    workExpansion.getSnapshot,
  )
  const rows = useMemo(
    () =>
      projectWorkRows(rawRows, {
        open,
        jobs: [],
        getMessage: store.getMessage,
        getMetadata: store.getMessageMetadata,
      }),
    [rawRows, open, store],
  )
  const scroller = useScroller({ mode: 'window' })
  const [revealed, setRevealed] = useState(false)
  const markRevealed = useCallback(() => setRevealed(true), [])
  const { scrollRef, sentinelRef, setReady, holdPosition } = scroller
  const rowsRef = useRef(rows)
  const virtuaRef = useRef<WindowVirtualizerHandle>(null)
  const metaRef = useRef(window.meta)
  const docScrollRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    rowsRef.current = rows
    docScrollRef.current = document.documentElement
  }, [rows])
  const deps: ScrollDeps = {
    scroller,
    rowsRef,
    virtuaRef,
    metaRef,
    docScrollRef,
    topPadding: 16,
  }
  const slide = useWindowSlide(deps, {
    ...window.controls,
    isSliding: window.meta.isSliding,
    older: { sessionId: 'pagination', rows, store, meta: window.meta },
  })
  const { scrollByPage } = usePageScroll(deps, slide)
  const { requestScrollToMessage } = useSeek(deps, {
    rows,
    messageStore: store,
    anchorAround: window.controls.anchorAround,
  })
  const { restore } = useScrollPersistence(deps, {
    sessionId: persist ? 'pagination' : undefined,
    messageStore: store,
    isAtBottom: false,
    requestScrollToMessage,
    followToBottom: window.controls.returnToLatest,
    onRestoreSettled: markRevealed,
    isPositioning: slide.isPositioning,
  })
  const restoreOrReveal = useCallback(() => {
    if (!restore()) {
      holdPosition()
      markRevealed()
    }
    return true
  }, [restore, holdPosition, markRevealed])
  useInitialPosition(deps, {
    isLoading: !persist || window.meta.isLoadingFirstPage,
    rowCount: rows.length,
    restoreScroll: restoreOrReveal,
    markRevealed,
  })
  useLayoutEffect(() => {
    metaRef.current = { ...window.meta, isLoadingOlder: slide.isLoadingOlder }
    scroller.setShiftInProgress(
      slide.isPositioning || slide.isLoadingOlder || window.meta.isLoadingNewer,
    )
  })
  useEffect(() => {
    if (persist) return
    setReady(true)
    holdPosition()
    return trackHeightSettle(() => {}, document.documentElement, markRevealed)
  }, [setReady, holdPosition, markRevealed])
  return (
    <>
      <nav className="bg-background fixed inset-x-0 top-0 z-30 h-16">
        Pagination fixture
      </nav>
      <main
        ref={scrollRef as React.RefObject<HTMLDivElement | null>}
        className="mx-auto w-full max-w-xl pt-16"
        style={{ paddingBottom: clamped ? 200 : undefined }}
        data-pagination-loading={slide.isLoadingOlder}
        data-window-positioning={slide.isPositioning}
        data-position-ready={revealed}
        data-window-requests={source.calls.length}
        onKeyDown={(event) => {
          if (event.key === 'PageUp') {
            event.preventDefault()
            scrollByPage(-1)
          }
        }}
      >
        <MessageListContent
          revealed={revealed}
          isEmpty={false}
          showLoadingIndicator={false}
          overlayInset={{ top: 0, bottom: 0 }}
          messages={{
            rows,
            hasHeaderContainer: true,
            topPaddingStyle: {},
            hasMore: window.meta.canLoadOlder,
            hasNewer: window.meta.canLoadNewer,
            isLoadingOlder: slide.isLoadingOlder,
            shiftItems: false,
            onLoadMore: slide.loadOlder,
            onLoadNewer: slide.loadNewer,
            virtuaRef,
            renderRow: (row) => <Row row={row} store={store} />,
          }}
        />
        <div
          ref={sentinelRef}
          className={middle || clamped ? 'h-20' : 'h-screen'}
        />
      </main>
    </>
  )
}

function WindowFixture() {
  const window = useMessageWindow('pagination' as Id<'sessions'>)
  const [store] = useState(createMessageStore)
  const converted = useMemo(
    () => convertMessages(window.messages),
    [window.messages],
  )
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('slow')) return
    source.defer()
    globalThis.addEventListener('resolve-pagination', source.resolve)
    globalThis.addEventListener('resolve-pagination-page', source.resolveNext)
    return () => {
      globalThis.removeEventListener('resolve-pagination', source.resolve)
      globalThis.removeEventListener(
        'resolve-pagination-page',
        source.resolveNext,
      )
    }
  }, [])
  useEffect(() => {
    const anchor = () =>
      window.controls.anchorAround({
        _id: 'm1',
        _creationTime: 1,
        segmentIndex: 4,
      })
    globalThis.addEventListener('anchor-pagination', anchor)
    return () => {
      globalThis.removeEventListener('anchor-pagination', anchor)
    }
  }, [window.controls])
  useLayoutEffect(() => {
    store.sync({
      sessionId: 'pagination',
      results: converted.messages,
      messageMetaByMessage: converted.byId,
      partMetaByMessage: converted.partMetaById,
      controls: window.controls,
      meta: window.meta,
      resetKey: window.resetKey,
      groupBySender: grouped || clamped,
    })
  }, [window, store, converted])
  return <Transcript window={window} store={store} />
}

/** Exercises bounded queries, production row projection, pagination, and scroll restoration. */
export function MessagePaginationFixture() {
  return (
    <ConvexProvider client={source.client}>
      <WindowFixture />
    </ConvexProvider>
  )
}
