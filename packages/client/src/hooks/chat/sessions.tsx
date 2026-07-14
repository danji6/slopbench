import {
  useActiveSessionId,
  useActiveStreamSessionIds,
} from '@/hooks/chat/session'
import { createUsableContext } from '@/hooks/context'
import type { SessionListItem } from '@/lib/chat'
import type { PaginationMetadata } from '@/lib/chat/message-store'
import { type SessionStore, createSessionStore } from '@/lib/chat/session-store'
import { api } from '@sb/convex/_generated/api'
import { usePaginatedQuery } from 'convex-helpers/react/cache'
import {
  type ReactNode,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'

const INITIAL_NUM_ITEMS = 20

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

export function SessionStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore)
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)

  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.list,
    { search: search.trim() || undefined, showHidden: showHidden || undefined },
    { initialNumItems: INITIAL_NUM_ITEMS },
  )
  const activeId = useActiveSessionId()
  const streamingIds = useActiveStreamSessionIds()

  useLayoutEffect(() => {
    store.sync({ results, loadMore, status, activeId, streamingIds })
  }, [store, results, loadMore, status, activeId, streamingIds])

  return (
    <SessionStoreContext.Provider value={store}>
      <SessionSearchContext.Provider value={setSearch}>
        <SessionShowHiddenContext.Provider value={{ showHidden, setShowHidden }}>
          {children}
        </SessionShowHiddenContext.Provider>
      </SessionSearchContext.Provider>
    </SessionStoreContext.Provider>
  )
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
