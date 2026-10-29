import {
  useActiveSessionId,
  useActiveStreamSessionIds,
} from '@/hooks/chat/session'
import { createUsableContext } from '@/hooks/context'
import type { SessionListItem } from '@/lib/chat'
import type { PaginationMetadata } from '@/lib/chat/message-store'
import { type SessionStore, createSessionStore } from '@/lib/chat/session-store'
import type { FolderView } from '@sb/convex/types'
import { parseSessionSearch } from '@sb/core/session-search/parse'
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'

import { useFolderPage } from './folder-page'
import { useSessionDrops } from './session-drops'
import { useSessionSearchPage } from './session-search-page'

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
  folders?: FolderView[]
  sessionsDeferred?: boolean
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

type PublishPage = (key: string, page: SessionGroupPage | null) => void

const [SessionPagesContext, usePublishSessionPage] =
  createUsableContext<PublishPage>('SessionPages')

/** Retains metadata identity when only a group's session rows change. */
function useLoadedFolders(pages: Record<string, SessionGroupPage>) {
  const [previous, setPrevious] = useState<FolderView[]>([])
  const folders = [
    ...new Map(
      Object.values(pages)
        .flatMap((page) => page.folders ?? [])
        .map((folder) => [folder._id, folder]),
    ).values(),
  ]
  const changed =
    folders.length !== previous.length ||
    folders.some((folder, index) => folder !== previous[index])
  if (!changed) return previous
  setPrevious(folders)
  return folders
}

export function SessionStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore)
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [serverPages, setPages] = useState<Record<string, SessionGroupPage>>({})
  const folders = useLoadedFolders(serverPages)
  const { pages, pendingSessionIds, dropSession } = useSessionDrops(serverPages, folders) // prettier-ignore
  const activeId = useActiveSessionId()
  const streamingIds = useActiveStreamSessionIds()
  const publish = useCallback((key: string, page: SessionGroupPage | null) => {
    setPages((current) => {
      const next = { ...current }
      if (page) next[key] = page
      else delete next[key]
      return next
    })
  }, [])

  const results = Object.values(pages).flatMap((page) => page.results)
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
            <SessionPagesContext.Provider value={publish}>
              {children}
            </SessionPagesContext.Provider>
          </SessionGroupsContext.Provider>
        </SessionShowHiddenContext.Provider>
      </SessionSearchContext.Provider>
    </SessionStoreContext.Provider>
  )
}

/** Keeps a visible folder's initial page ready without publishing hidden rows. */
export function SessionGroupPreload({ groupKey }: { groupKey: string }) {
  const { showHidden } = useSessionShowHidden()
  useFolderPage({ groupKey, search: '', showHidden })
  return null
}

/** Loads a group's display pages only while its contents are mounted. */
export function SessionGroupQuery({
  groupKey,
  search = '',
}: {
  groupKey: string
  search?: string
}) {
  const { showHidden } = useSessionShowHidden()
  const query = search.trim()
  return (
    <SessionGroupLoader
      key={JSON.stringify([groupKey, query, showHidden])}
      groupKey={groupKey}
      search={query}
      showHidden={showHidden}
    />
  )
}

type SessionGroupLoaderProps = {
  groupKey: string
  search: string
  showHidden: boolean
}

function SessionGroupLoader({
  groupKey,
  search,
  showHidden,
}: SessionGroupLoaderProps) {
  const publish = usePublishSessionPage()
  const candidates = useFolderPage({ groupKey, search, showHidden })
  const hasFilters = parseSessionSearch(search).clauses.length > 0
  const { results, status, loadMore } = useSessionSearchPage(
    candidates,
    hasFilters,
  )

  useLayoutEffect(() => {
    publish(groupKey, {
      results,
      status,
      loadMore,
      folders: candidates.folders,
      sessionsDeferred: candidates.sessionsDeferred,
    })
  }, [
    groupKey,
    results,
    status,
    loadMore,
    candidates.folders,
    candidates.sessionsDeferred,
    publish,
  ])
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
