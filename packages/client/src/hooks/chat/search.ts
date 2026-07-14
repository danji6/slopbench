import { useDebouncedCallback } from '@/hooks/debounce'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { usePaginatedQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useCallback, useState } from 'react'

const INITIAL_NUM_ITEMS = 20
const SEARCH_DEBOUNCE = 250

export type MessageSearchResult = FunctionReturnType<
  typeof api.chat.searchMessages
>['page'][number]

/** Debounced full-text search over a session's messages. */
export function useMessageSearch(sessionId: Id<'sessions'> | null) {
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')

  const commit = useDebouncedCallback(setTerm, SEARCH_DEBOUNCE)
  const setSearch = useCallback(
    (value: string) => {
      setQuery(value)
      commit.run(value)
    },
    [commit],
  )

  const trimmed = term.trim()
  const { results, status, loadMore, isLoading } = usePaginatedQuery(
    api.chat.searchMessages,
    sessionId && trimmed ? { sessionId, term: trimmed } : 'skip',
    { initialNumItems: INITIAL_NUM_ITEMS },
  )

  return {
    query,
    term: trimmed,
    setSearch,
    results,
    status,
    loadMore,
    isLoading,
  }
}
