import { HiddenChip } from '@/components/chat/messages/hidden-chip'
import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { MessageListContent } from '@/components/chat/messages/message-list/message-list-content'
import { MessageListContext } from '@/components/chat/messages/message-list/message-list-context'
import { MessageRowView } from '@/components/chat/messages/message-row-view'
import { NoteGroupBlock } from '@/components/chat/messages/note-group-block'
import { WorkBlock } from '@/components/chat/messages/work-block'
import '@/globals.css'
import { useScrollPersistence } from '@/hooks/chat/message-list/scroll-persistence'
import { useSeek } from '@/hooks/chat/message-list/seek'
import {
  ChatMessagesProvider,
  useChatMessage,
  useMessageRows,
  useMessageStore,
  useWindowControls,
} from '@/hooks/chat/messages'
import { StreamStoreProvider } from '@/hooks/chat/stream'
import { useScroller } from '@/hooks/scroller'
import type { MessageRow } from '@/lib/chat/rows'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WindowVirtualizerHandle } from 'virtua'

import { appendNote, isNoteRow, notesClient } from './notes-client'

const noop = () => {}
const groupedWork = new URLSearchParams(location.search).has('groupedWork')

function NoteRow({ row }: { row: MessageRow }) {
  const { message, messageMeta } = useChatMessage(row.messageId)
  if (row.kind === 'note-group') return <NoteGroupBlock row={row} />
  if (!message) return null
  if (row.kind === 'work') {
    return <WorkBlock row={row} message={message} record={messageMeta} />
  }
  return <HiddenChip message={message} record={messageMeta} />
}

function Transcript() {
  const [groupSettled, setGroupSettled] = useState(false)
  const [hideDuration, setHideDuration] = useState(false)
  const rows = useMessageRows()
  const store = useMessageStore()
  const { anchorAround } = useWindowControls()
  const scroller = useScroller({ mode: 'window', bottomInset: 80 })
  const { scrollRef, sentinelRef, setReady, holdPosition } = scroller
  const rowsRef = useRef(rows)
  const virtuaRef = useRef<WindowVirtualizerHandle>(null)
  const docScrollRef = useRef<HTMLElement | null>(null)
  const metaRef = useRef(store.getWindowMetadata())
  useLayoutEffect(() => {
    rowsRef.current = rows
    docScrollRef.current = document.documentElement
    metaRef.current = store.getWindowMetadata()
  }, [rows, store])
  const deps: ScrollDeps = {
    scroller,
    rowsRef,
    virtuaRef,
    docScrollRef,
    metaRef,
    topPadding: 16,
  }
  const { requestScrollToMessage } = useSeek(deps, {
    rows,
    messageStore: store,
    anchorAround,
  })
  const { restore } = useScrollPersistence(deps, {
    sessionId: 'notes',
    messageStore: store,
    isAtBottom: false,
    requestScrollToMessage,
    followToBottom: noop,
    onRestoreSettled: noop,
  })
  useEffect(() => {
    setReady(true)
  }, [setReady])
  useEffect(() => {
    restore()
  }, [restore])

  return (
    <MessageListContext
      value={{
        scrollRef,
        onLayoutChange: holdPosition,
        releaseFollow: holdPosition,
        resumeFollow: noop,
        bottomPadding: 80,
        topPadding: 16,
      }}
    >
      <nav className="bg-background fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 px-2 text-xs">
        {groupedWork && (
          <button onClick={() => setHideDuration(true)}>Hide duration</button>
        )}
        <button
          data-seek-settled={groupSettled}
          onClick={() => {
            setGroupSettled(false)
            requestScrollToMessage('mcp', 40, undefined, {
              kind: 'restore',
              rowKey: 'notes:mcp',
              onSettled: () => setGroupSettled(true),
            })
          }}
        >
          Group
        </button>
        <button onClick={() => requestScrollToMessage('workspace', 41)}>
          Seek workspace
        </button>
        <button onClick={() => requestScrollToMessage('mcp', 40)}>
          Seek first
        </button>
        <button onClick={appendNote}>Append</button>
        <button onClick={() => requestScrollToMessage('before0', 0)}>
          Top
        </button>
      </nav>
      <main
        ref={scrollRef as React.RefObject<HTMLDivElement | null>}
        className="mx-auto w-full max-w-xl px-3 pt-16 pb-24"
      >
        <MessageListContent
          revealed
          isEmpty={false}
          showLoadingIndicator={false}
          overlayInset={{ top: 0, bottom: 0 }}
          messages={{
            rows,
            hasHeaderContainer: false,
            topPaddingStyle: {},
            hasMore: false,
            hasNewer: false,
            shiftItems: false,
            onLoadMore: () => {},
            onLoadNewer: () => {},
            virtuaRef,
            renderRow: (row) =>
              groupedWork ? (
                <MessageRowView
                  row={
                    hideDuration && row.kind === 'footer'
                      ? { ...row, duration: undefined }
                      : row
                  }
                />
              ) : isNoteRow(row) || row.kind === 'work' ? (
                <NoteRow row={row} />
              ) : (
                <article className="h-24">{row.messageId}</article>
              ),
          }}
        />
        <div ref={sentinelRef} />
      </main>
    </MessageListContext>
  )
}

/** Uses production note rendering, row projection, virtualization, and seeking. */
export function NotesFixture() {
  return (
    <ConvexProvider client={notesClient}>
      <ConvexQueryCacheProvider>
        <ChatMessagesProvider>
          <StreamStoreProvider>
            <Transcript />
          </StreamStoreProvider>
        </ChatMessagesProvider>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
