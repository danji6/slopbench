import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import {
  MessageListContext,
  usePendingMessageLayout,
} from '@/components/chat/messages/message-list/message-list-context'
import { useFollowEdges } from '@/hooks/chat/message-list/follow-edges'
import { useSeek } from '@/hooks/chat/message-list/seek'
import { useScroller } from '@/hooks/scroller'
import { createMessageStore } from '@/lib/chat/message-store'
import type { MessageRow } from '@/lib/chat/rows'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { WindowVirtualizer, type WindowVirtualizerHandle } from 'virtua'

type ChangesPhase = 'off' | 'loading' | 'summary' | 'files'
type WindowPhase = 'expanded' | 'loading' | 'trimmed'

/** Models the summary query followed by the file-list query on a mounted footer. */
function DelayedChangesSummary({ phase }: { phase: ChangesPhase }) {
  usePendingMessageLayout(phase !== 'files')
  if (phase === 'loading') return null
  return (
    <section style={{ padding: 16, border: '1px solid #ccc' }}>
      <div style={{ height: 80 }}>Changes made</div>
      {phase === 'files' && (
        <div data-loaded-files style={{ height: 160 }}>
          Three changed files
        </div>
      )}
    </section>
  )
}

/** Uses production scrolling hooks and virtua with deterministic local rows. */
export function ScrollFixture() {
  const trimWindow = new URLSearchParams(location.search).has('trim-window')
  const [windowPhase, setWindowPhase] = useState<WindowPhase>('expanded')
  const [count, setCount] = useState(80)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [inset, setInset] = useState(80)
  const [streaming, setStreaming] = useState(false)
  const [changes, setChanges] = useState<ChangesPhase>('off')
  const messageOffset = windowPhase === 'expanded' ? 0 : 60
  const rows = useMemo<MessageRow[]>(
    () =>
      Array.from({ length: count }, (_, index) => ({
        kind: 'group',
        messageId: `m${index + messageOffset}`,
        key: `m${index + messageOffset}`,
        segmentIndex: 0,
        groupIndex: 0,
      })),
    [count, messageOffset],
  )
  const scroller = useScroller({
    mode: 'window',
    enabled: !editing,
    editing,
    bottomInset: inset,
  })
  const { setReady, scrollToBottom, scrollRef, sentinelRef } = scroller
  const rowsRef = useRef(rows)
  const virtuaRef = useRef<WindowVirtualizerHandle>(null)
  const docScrollRef = useRef<HTMLElement | null>(null)
  const metaRef = useRef({
    canLoadOlder: false,
    canLoadNewer: false,
    isAtLiveTail: true,
    isLoadingOlder: false,
    isLoadingNewer: false,
  })
  const [store] = useState(() => createMessageStore())
  useLayoutEffect(() => {
    rowsRef.current = rows
    docScrollRef.current = document.documentElement
    metaRef.current.isLoadingNewer = windowPhase === 'loading'
  }, [rows, windowPhase])
  const deps: ScrollDeps = {
    scroller,
    rowsRef,
    virtuaRef,
    docScrollRef,
    metaRef,
    topPadding: 16,
  }
  const { followToBottom, followToTop } = useFollowEdges(deps, {
    returnToLatest: () => {
      if (!trimWindow) return
      setWindowPhase('loading')
      setCount(20)
    },
    returnToOldest: () => {},
    status: streaming ? 'streaming' : 'ready',
    isAtLiveTail: true,
    canLoadOlder: false,
    rows,
    setFollowOverride: () => {},
  })
  const { requestScrollToMessage } = useSeek(deps, {
    rows,
    messageStore: store,
    anchorAround: () => {},
  })
  useEffect(() => {
    setReady(true)
    scrollToBottom(true)
  }, [setReady, scrollToBottom])
  useEffect(() => {
    if (!streaming) return
    const timer = setInterval(() => setCount((value) => value + 1), 80)
    return () => clearInterval(timer)
  }, [streaming])
  return (
    <MessageListContext
      value={{
        scrollRef: docScrollRef,
        onLayoutChange: () => {},
        releaseFollow: scroller.holdPosition,
        resumeFollow: () => scroller.unlockScroll(true),
        trackPendingLayout: scroller.coordinator.trackPendingLayout,
        bottomPadding: inset,
        topPadding: 16,
      }}
    >
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          background: 'white',
          zIndex: 10,
        }}
      >
        <button onClick={followToTop}>Top</button>
        <button onClick={followToBottom}>Bottom</button>
        {trimWindow && (
          <button onClick={() => setWindowPhase('trimmed')}>
            Resolve window
          </button>
        )}
        <button onClick={() => setChanges('loading')}>Delay changes</button>
        <button onClick={() => setChanges('summary')}>Resolve summaries</button>
        <button onClick={() => setChanges('files')}>Resolve files</button>
        <button onClick={() => requestScrollToMessage('m20')}>Seek 20</button>
        <button
          onClick={() => {
            requestScrollToMessage('m120', 1)
            setTimeout(() => setCount(140), 300)
          }}
        >
          Seek delayed
        </button>
        <button onClick={() => setStreaming((value) => !value)}>
          Stream {streaming ? 'on' : 'off'}
        </button>
        <button onClick={() => setEditing((value) => !value)}>
          Edit {editing ? 'on' : 'off'}
        </button>
        <button
          onClick={() => {
            scroller.holdPosition()
            setExpanded((value) => !value)
          }}
        >
          Expand work
        </button>
        <button onClick={() => setInset((value) => (value === 80 ? 180 : 80))}>
          Resize dock
        </button>
        <button
          onClick={() => {
            scroller.coordinator.cancel()
            setCount(80)
            followToTop()
          }}
        >
          Switch session
        </button>
      </nav>
      <div
        ref={scrollRef as React.RefObject<HTMLDivElement | null>}
        data-row-count={count}
        data-window-phase={windowPhase}
        style={{ paddingTop: 64, paddingBottom: inset }}
      >
        {windowPhase === 'trimmed' && (
          <div style={{ height: 72 }}>Load older messages</div>
        )}
        <WindowVirtualizer ref={virtuaRef} data={rows}>
          {(row) => (
            <article
              data-message-id={row.messageId}
              data-row-key={row.key}
              style={{
                minHeight: expanded ? 160 : 80,
                borderBottom: '1px solid #ddd',
              }}
            >
              {row.messageId}
              {changes !== 'off' && ['m78', 'm79'].includes(row.messageId) && (
                <DelayedChangesSummary phase={changes} />
              )}
              {editing && row.messageId === 'm20' && (
                <textarea aria-label="Edit message" defaultValue="Draft" />
              )}
            </article>
          )}
        </WindowVirtualizer>
        <div ref={sentinelRef} style={{ height: 1 }} />
      </div>
    </MessageListContext>
  )
}
