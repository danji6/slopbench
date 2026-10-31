import { api } from '@sb/convex/_generated/api'
import { usePaginatedQuery } from 'convex-helpers/react/cache/hooks'
import { useEffect, useState } from 'react'

/** Loads recent cards first, and searches beyond already-loaded agents. */
export function useAgentPage(search: string) {
  const [budget, setBudget] = useState(search ? 12 : 4)
  const page = usePaginatedQuery(
    api.agents.page,
    { search: search || undefined },
    { initialNumItems: search ? 12 : 4 },
  )
  const { results, status, loadMore } = page

  useEffect(() => {
    if (status === 'CanLoadMore' && results.length < budget) {
      loadMore(budget - results.length)
    }
  }, [budget, results.length, status, loadMore])

  const loading = status !== 'Exhausted' && results.length < budget
  return {
    agents: results.slice(0, budget),
    loading,
    hasMore: status !== 'Exhausted',
    expanded: budget > 4,
    loadMore: () => setBudget((count) => count + 12),
  }
}
