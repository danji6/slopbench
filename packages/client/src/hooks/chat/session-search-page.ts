import type { SessionGroupPage } from '@/hooks/chat/sessions'
import { useCallback, useEffect, useMemo, useState } from 'react'

const SEARCH_PAGE_SIZE = 20

type SearchPageRequest = { target: number; visibleCount: number | null }

/** Fills a requested number of matches across sequential candidate pages. */
export function useSessionSearchPage(
  page: SessionGroupPage,
  enabled: boolean,
): SessionGroupPage {
  const [request, setRequest] = useState<SearchPageRequest>({
    target: SEARCH_PAGE_SIZE,
    visibleCount: null,
  })
  const { target, visibleCount } = request
  const { results, status, loadMore: loadCandidates } = page
  const filling = enabled && results.length < target && status !== 'Exhausted'
  const buffering = filling || status === 'LoadingMore'
  if (!buffering && visibleCount !== null) {
    setRequest({ target, visibleCount: null })
  }

  useEffect(() => {
    if (filling && status === 'CanLoadMore') {
      // Convex's loadMore guards against overlapping requests for this cursor
      loadCandidates(SEARCH_PAGE_SIZE)
    }
  }, [filling, status, loadCandidates])

  const loadMore = useCallback(
    (count: number) => {
      if (!enabled) return loadCandidates(count)
      if (filling || status !== 'CanLoadMore') return
      setRequest({
        target: results.length + count,
        visibleCount: results.length,
      })
    },
    [enabled, filling, status, results.length, loadCandidates],
  )

  // Reveal all newly requested matches together after sparse pages finish
  const visibleResults = useMemo(
    () =>
      buffering && visibleCount !== null
        ? results.slice(0, visibleCount)
        : results,
    [buffering, visibleCount, results],
  )

  const fillingStatus = target === SEARCH_PAGE_SIZE ? 'LoadingFirstPage' : 'LoadingMore' // prettier-ignore
  return {
    results: visibleResults,
    status: filling ? fillingStatus : status,
    loadMore,
  }
}
