import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { useFollowEdges } from '@/components/chat/messages/message-list/hooks/follow-edges'
import { useSeek } from '@/components/chat/messages/message-list/hooks/seek'
import { useScroller } from '@/hooks/scroller'
import { createMessageStore } from '@/lib/chat/message-store'
import type { MessageRow } from '@/lib/chat/rows'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { WindowVirtualizer, type WindowVirtualizerHandle } from 'virtua'

/** Uses production scrolling hooks and virtua with deterministic local rows. */
export function ScrollFixture() {
  const [count, setCount] = useState(80)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [inset, setInset] = useState(80)
  const [streaming, setStreaming] = useState(false)
  const rows = useMemo<MessageRow[]>(
    () =>
      Array.from({ length: count }, (_, index) => ({
        kind: 'group',
        messageId: `m${index}`,
        key: `m${index}`,
        segmentIndex: 0,
        groupIndex: 0,
      })),
    [count],
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
  }, [rows])
  const deps: ScrollDeps = {
    scroller,
    rowsRef,
    virtuaRef,
    docScrollRef,
    metaRef,
    topPadding: 16,
  }
  const { followToBottom, followToTop } = useFollowEdges(deps, {
    returnToLatest: () => {},
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
    <>
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
        style={{ paddingTop: 64, paddingBottom: inset }}
      >
        <WindowVirtualizer ref={virtuaRef} data={rows}>
          {(row) => (
            <article
              data-message-id={row.messageId}
              data-row-key={row.key}
              style={{
                height: expanded ? 160 : 80,
                borderBottom: '1px solid #ddd',
              }}
            >
              {row.messageId}
              {editing && row.messageId === 'm20' && (
                <textarea aria-label="Edit message" defaultValue="Draft" />
              )}
            </article>
          )}
        </WindowVirtualizer>
        <div ref={sentinelRef} style={{ height: 1 }} />
      </div>
    </>
  )
}
