import { ChatSessionView } from '@/components/chat/chat-session-view'
import { HiddenChip } from '@/components/chat/messages/hidden-chip'
import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { MessageListContent } from '@/components/chat/messages/message-list/message-list-content'
import { MessageListContext } from '@/components/chat/messages/message-list/message-list-context'
import { MessageRowView } from '@/components/chat/messages/message-row-view'
import { NoteGroupBlock } from '@/components/chat/messages/note-group-block'
import { WorkBlock } from '@/components/chat/messages/work-block'
import { ChatSearchProvider } from '@/components/chat/search/chat-search-context'
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
import { useSendMessage } from '@/hooks/chat/send'
import { StreamStoreProvider, useChatStatus } from '@/hooks/chat/stream'
import { useWorkspaceFileIndex } from '@/hooks/chat/workspace'
import { useScroller } from '@/hooks/scroller'
import type { MessageRow } from '@/lib/chat/rows'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WindowVirtualizerHandle } from 'virtua'

import {
  appendNote,
  appendWaitingShellOutput,
  isNoteRow,
  notesClient,
  publishSubmittedShellOutput,
  waitForShellInput,
} from './notes-client'

const noop = () => {}
const TOP_PADDING = 16
const groupedWork = new URLSearchParams(location.search).has('groupedWork')
const tailWork = new URLSearchParams(location.search).has('tailWork')
const shellReports = new URLSearchParams(location.search).has('shellReports')
const fileChanges = new URLSearchParams(location.search).has('fileChanges')
const longShell = new URLSearchParams(location.search).has('longShell')
const compaction = new URLSearchParams(location.search).has('compaction')
const thinkingWork = new URLSearchParams(location.search).has('thinkingWork')
const reminderWork = new URLSearchParams(location.search).has('reminderWork')
const composerParams = new URLSearchParams(location.search)
const showComposer =
  composerParams.has('shellComposer') || composerParams.has('composer')

function NoteRow({ row }: { row: MessageRow }) {
  const { message, messageMeta } = useChatMessage(row.messageId)
  if (row.kind === 'note-group') return <NoteGroupBlock row={row} />
  if (!message) return null
  if (row.kind === 'work') {
    return <WorkBlock row={row} message={message} record={messageMeta} />
  }
  if (row.kind !== 'hidden') return null
  return (
    <HiddenChip
      message={message}
      record={messageMeta}
      placement={row.placement}
    />
  )
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
    topPadding: TOP_PADDING,
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
        scrollRef: docScrollRef,
        scrollCoordinator: scroller.coordinator,
        onLayoutChange: scroller.holdLayoutPosition,
        trackPendingLayout: scroller.coordinator.trackPendingLayout,
        releaseFollow: holdPosition,
        resumeFollow: noop,
        bottomPadding: 80,
        topPadding: TOP_PADDING,
      }}
    >
      <nav className="bg-background fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 px-2 text-xs">
        {longShell && (
          <>
            <button onClick={waitForShellInput}>Wait for terminal input</button>
            <button onClick={appendWaitingShellOutput}>
              Append terminal output
            </button>
          </>
        )}
        {shellReports && (
          <button onClick={() => requestScrollToMessage('shell2', 2)}>
            Seek report
          </button>
        )}
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
        className="mx-auto w-full max-w-xl px-3 pb-24"
      >
        <MessageListContent
          revealed
          isEmpty={false}
          showLoadingIndicator={false}
          overlayInset={{ top: 0, bottom: 0 }}
          messages={{
            rows,
            hasHeaderContainer: false,
            topPaddingStyle: {
              paddingTop: `calc(var(--spacing)*${TOP_PADDING})`,
            },
            hasMore: false,
            hasNewer: false,
            shiftItems: false,
            onLoadMore: () => {},
            onLoadNewer: () => {},
            virtuaRef,
            renderRow: (row) =>
              groupedWork ||
              tailWork ||
              shellReports ||
              fileChanges ||
              compaction ||
              thinkingWork ||
              reminderWork ? (
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

function Composer() {
  useEffect(() => {
    window.addEventListener(
      'publish-submitted-shell-output',
      publishSubmittedShellOutput,
    )
    return () =>
      window.removeEventListener(
        'publish-submitted-shell-output',
        publishSubmittedShellOutput,
      )
  }, [])

  return (
    <ChatSessionView
      dockWidth="min(95%, 800px)"
      topPadding={16}
      status={useChatStatus()}
      error={null}
      onSubmit={useSendMessage()}
      onStop={noop}
      onRunCommand={async () => {}}
      onContinueAgent={noop}
      hasActiveAgent={false}
      onDismissError={noop}
      fileIndex={useWorkspaceFileIndex(undefined, false)}
    />
  )
}

/** Uses production note rendering, row projection, virtualization, and seeking. */
export function NotesFixture() {
  return (
    <ConvexProvider client={notesClient}>
      <ConvexQueryCacheProvider>
        <ChatMessagesProvider>
          <StreamStoreProvider>
            {showComposer ? (
              <ChatSearchProvider>
                <Composer />
              </ChatSearchProvider>
            ) : (
              <Transcript />
            )}
          </StreamStoreProvider>
        </ChatMessagesProvider>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
