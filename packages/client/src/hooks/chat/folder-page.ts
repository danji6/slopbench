import { api } from '@cv/convex/_generated/api'
import { usePaginatedQuery } from 'convex-helpers/react/cache/hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { SessionGroupPage } from './sessions'

type FolderPageOptions = {
  groupKey: string
  search: string
  showHidden: boolean
}

type FolderPageSnapshot = Pick<SessionGroupPage, 'results' | 'folders'>

/** Coordinates folder-first pages and the root's independent initial allowances. */
export function useFolderPage({
  groupKey,
  search,
  showHidden,
}: FolderPageOptions): SessionGroupPage {
  const isSearch = groupKey === 'search'
  const isRoot = groupKey === 'ungrouped'
  const [budget, setBudget] = useState(isRoot ? 10 : 5)
  const [rootSessions, setRootSessions] = useState(10)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [snapshot, setSnapshot] = useState<FolderPageSnapshot | null>(null)

  const {
    results: folderResults,
    status: folderStatus,
    loadMore: loadFolders,
  } = usePaginatedQuery(
    api.sessionFolders.page,
    isSearch ? 'skip' : { groupKey },
    { initialNumItems: isRoot ? 10 : 5 },
  )

  const folderItems = useMemo(
    () => (isSearch ? [] : folderResults.slice(0, budget)),
    [isSearch, folderResults, budget],
  )
  const foldersDone = isSearch || folderStatus === 'Exhausted'
  const rootSessionBudget = Math.max(
    rootSessions,
    budget > 10 && foldersDone ? budget + 10 - folderItems.length : 10,
  )
  const sessionBudget = isSearch
    ? 20
    : isRoot
      ? rootSessionBudget
      : Math.max(0, budget - folderItems.length)
  const needSessions = isSearch || isRoot || (foldersDone && sessionBudget > 0)

  const sessions = usePaginatedQuery(
    api.sessions.list,
    needSessions
      ? {
          groupKey: isSearch ? undefined : groupKey,
          search: search || undefined,
          showHidden: showHidden || undefined,
        }
      : 'skip',
    { initialNumItems: Math.max(1, sessionBudget) },
  )

  const {
    results: sessionResults,
    status: sessionStatus,
    loadMore: loadSessions,
  } = sessions

  useEffect(() => {
    if (
      !isSearch &&
      folderStatus === 'CanLoadMore' &&
      folderResults.length < budget
    ) {
      loadFolders(budget - folderResults.length)
    }
  }, [isSearch, folderStatus, folderResults.length, loadFolders, budget])

  useEffect(() => {
    if (
      !isSearch &&
      needSessions &&
      sessionStatus === 'CanLoadMore' &&
      sessionResults.length < sessionBudget
    ) {
      loadSessions(sessionBudget - sessionResults.length)
    }
  }, [
    isSearch,
    needSessions,
    sessionStatus,
    sessionResults.length,
    loadSessions,
    sessionBudget,
  ])

  const loadingFolders =
    !isSearch && folderResults.length < budget && !foldersDone
  const loadingSessions =
    needSessions &&
    sessionResults.length < sessionBudget &&
    sessionStatus !== 'Exhausted'
  const loading = loadingFolders || loadingSessions
  const moreSessions = needSessions && sessionStatus !== 'Exhausted'
  const status = loading
    ? hasLoaded
      ? 'LoadingMore'
      : 'LoadingFirstPage'
    : !foldersDone || moreSessions
      ? 'CanLoadMore'
      : 'Exhausted'

  const loadMore = useCallback(
    (count: number) => {
      if (isSearch) return loadSessions(count)
      if (loading) return
      setSnapshot({
        results: sessionResults.slice(0, sessionBudget),
        folders: folderItems,
      })
      if (isRoot && foldersDone) setRootSessions(sessionBudget + count)
      else setBudget((current) => current + count)
    },
    [
      isSearch,
      isRoot,
      foldersDone,
      loading,
      loadSessions,
      sessionResults,
      sessionBudget,
      folderItems,
    ],
  )

  const results = useMemo(
    () => sessionResults.slice(0, sessionBudget),
    [sessionResults, sessionBudget],
  )
  if (isSearch) return sessions
  if (!hasLoaded && !loading) setHasLoaded(true)
  if (snapshot && !loading) setSnapshot(null)
  if (snapshot && loading)
    return { ...snapshot, status: 'LoadingMore', loadMore }
  return {
    results,
    folders: folderItems,
    status,
    loadMore,
    sessionsDeferred: !needSessions,
  }
}
