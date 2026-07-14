import { Input } from '@/components/ui'
import { useDebouncedCallback } from '@/hooks'
import {
  useSession,
  useSessionIds,
  useSessionPagination,
  useSessionSearch,
} from '@/hooks/chat'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation } from 'convex/react'
import { memo, useCallback, useRef, useState } from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'

import { SessionListMenu } from './session-list-menu'
import { SessionRow } from './session-row'
import { SessionTitleEditor } from './session-title-editor'

const INITIAL_NUM_ITEMS = 20
const SCROLL_THRESHOLD = 200
const SEARCH_DEBOUNCE = 250

export const SessionListView = memo(function SessionListView() {
  const ids = useSessionIds()
  const { status, isLoadingFirstPage, loadMore } = useSessionPagination()
  const setSearch = useSessionSearch()

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtuaRef = useRef<VirtualizerHandle>(null)

  const [query, setQuery] = useState('')
  const commitSearch = useDebouncedCallback(setSearch, SEARCH_DEBOUNCE)
  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value)
      commitSearch.run(value)
    },
    [commitSearch],
  )

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const rename = useCallback((id: string) => setRenamingId(id), [])

  const handleScroll = useCallback(() => {
    const v = virtuaRef.current
    if (!v || status !== 'CanLoadMore') return
    if (v.scrollOffset + v.viewportSize >= v.scrollSize - SCROLL_THRESHOLD) {
      loadMore(INITIAL_NUM_ITEMS)
    }
  }, [status, loadMore])

  const showSearch = ids.length > 3 || status === 'CanLoadMore' || query !== ''
  const isEmpty = ids.length === 0 && !isLoadingFirstPage

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <header className="flex flex-col gap-2 px-3">
        <div className="flex items-center justify-between gap-2">
          <span className="ml-2 font-bold">Sessions</span>
          <SessionListMenu />
        </div>
        {showSearch && (
          <Input
            placeholder="Search..."
            value={query}
            onValueChange={handleQueryChange}
            className="border-input/50 h-10"
          />
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2">
        {isEmpty ? (
          <div className="text-muted-foreground p-2 text-center text-xs">
            No sessions yet
          </div>
        ) : (
          <Virtualizer
            ref={virtuaRef}
            scrollRef={scrollRef as React.RefObject<HTMLElement>}
            data={ids}
            onScroll={handleScroll}
          >
            {(id) => (
              <div className="py-0.5">
                <SessionRow id={id} rename={rename} />
              </div>
            )}
          </Virtualizer>
        )}
      </div>

      {renamingId !== null && (
        <SessionRenameDialog
          id={renamingId}
          onClose={() => setRenamingId(null)}
        />
      )}
    </div>
  )
})

function SessionRenameDialog({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const session = useSession(id)
  const updateSession = useMutation(api.sessions.update)
  const regenerateTitle = useAction(api.actions.sessions.regenerateTitle)

  return (
    <SessionTitleEditor
      show
      initialValue={session?.title}
      onClose={onClose}
      onConfirm={async (title) => {
        await updateSession({ sessionId: id as Id<'sessions'>, title })
        onClose()
      }}
      onRegenerate={() => regenerateTitle({ sessionId: id as Id<'sessions'> })}
    />
  )
}
