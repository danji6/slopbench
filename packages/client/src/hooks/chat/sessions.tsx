import {
  useActiveSessionId,
  useActiveStreamSessionIds,
} from '@/hooks/chat/session'
import { createUsableContext } from '@/hooks/context'
import type { SessionListItem } from '@/lib/chat'
import type { PaginationMetadata } from '@/lib/chat/message-store'
import { type SessionStore, createSessionStore } from '@/lib/chat/session-store'
import { api } from '@sb/convex/_generated/api'
import type { FolderView } from '@sb/convex/types'
import { usePaginatedQuery } from 'convex-helpers/react/cache'
import { useQuery } from 'convex/react'
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'

import { useSessionDrops } from './session-drops'

const INITIAL_NUM_ITEMS = 5
const INITIAL_SEARCH_ITEMS = 20

const [SessionStoreContext, useSessionStore] =
  createUsableContext<SessionStore>('SessionStore')

const [SessionSearchContext, useSessionSearch] =
  createUsableContext<(query: string) => void>('SessionSearch')

interface ShowHiddenControls {
  showHidden: boolean
  setShowHidden: (value: boolean) => void
}

const [SessionShowHiddenContext, useSessionShowHidden] =
  createUsableContext<ShowHiddenControls>('SessionShowHidden')

export { useSessionSearch, useSessionShowHidden }

export type SessionGroupPage = {
  results: SessionListItem[]
  status: PaginationMetadata['status']
  loadMore: (count: number) => void
}

const [SessionGroupsContext, useSessionGroups] = createUsableContext<{
  pages: Record<string, SessionGroupPage>
  search: string
  folders: FolderView[]
  pendingSessionIds: Set<string>
  dropSession: (item: SessionListItem, target: string) => Promise<void>
}>('SessionGroups')

export { useSessionGroups }

export function SessionStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore)
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const folders = useQuery(api.sessionFolders.list) ?? []
  const [serverPages, setPages] = useState<Record<string, SessionGroupPage>>({})
  const { pages, pendingSessionIds, dropSession } = useSessionDrops(serverPages, folders) // prettier-ignore
  const activeId = useActiveSessionId()
  const streamingIds = useActiveStreamSessionIds()
  const keys = search.trim()
    ? ['search']
    : ['pinned', ...folders.map((f) => f._id), 'ungrouped']

  const publish = useCallback((key: string, page: SessionGroupPage | null) => {
    setPages((current) => {
      const next = { ...current }
      if (page) next[key] = page
      else delete next[key]
      return next
    })
  }, [])

  const results = keys.flatMap((key) => pages[key]?.results ?? [])
  useLayoutEffect(() => {
    store.sync({
      results,
      loadMore: () => {},
      status: 'Exhausted',
      activeId,
      streamingIds,
    })
  }, [store, results, activeId, streamingIds])

  return (
    <SessionStoreContext.Provider value={store}>
      <SessionSearchContext.Provider value={setSearch}>
        <SessionShowHiddenContext.Provider
          value={{ showHidden, setShowHidden }}
        >
          <SessionGroupsContext.Provider
            value={{ pages, search, folders, pendingSessionIds, dropSession }}
          >
            {keys.map((key) => (
              <GroupQuery
                key={key}
                groupKey={key}
                search={search}
                showHidden={showHidden}
                publish={publish}
              />
            ))}
            {children}
          </SessionGroupsContext.Provider>
        </SessionShowHiddenContext.Provider>
      </SessionSearchContext.Provider>
    </SessionStoreContext.Provider>
  )
}

function GroupQuery({
  groupKey,
  search,
  showHidden,
  publish,
}: {
  groupKey: string
  search: string
  showHidden: boolean
  publish: (key: string, page: SessionGroupPage | null) => void
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.list,
    {
      groupKey: groupKey === 'search' ? undefined : groupKey,
      search: search.trim() || undefined,
      showHidden: showHidden || undefined,
    },
    {
      initialNumItems:
        groupKey === 'search' ? INITIAL_SEARCH_ITEMS : INITIAL_NUM_ITEMS,
    },
  )

  useLayoutEffect(() => {
    publish(groupKey, { results, status, loadMore })
  }, [groupKey, results, status, loadMore, publish])
  useLayoutEffect(() => () => publish(groupKey, null), [groupKey, publish])

  return null
}

export function useSessionIds(): string[] {
  const store = useSessionStore()
  return useSyncExternalStore(store.subscribe, store.getIds)
}

export function useSession(id: string): SessionListItem | null {
  const store = useSessionStore()
  return useSyncExternalStore(store.subscribe, () => store.getSession(id))
}

export function useSessionIsActive(id: string): boolean {
  const store = useSessionStore()
  return useSyncExternalStore(store.subscribe, () => store.getIsActive(id))
}

export function useSessionIsStreaming(id: string): boolean {
  const store = useSessionStore()
  return useSyncExternalStore(store.subscribe, () => store.getIsStreaming(id))
}

export function useSessionPagination(): PaginationMetadata & {
  loadMore: (numItems: number) => void
} {
  const store = useSessionStore()
  const meta = useSyncExternalStore(
    store.subscribe,
    store.getPaginationMetadata,
  )
  return { ...meta, loadMore: store.loadMore }
}
