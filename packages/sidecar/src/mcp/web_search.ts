import type {
  SearchEngineId,
  WebSearchInput,
  WebSearchInstance,
  WebSearchQuery,
} from '@sb/core/types'

import {
  type SearchContext,
  type SearxngSearchResult,
  formatErrorMessage,
  searchSearxng,
} from './searxng'

/** Overall time budget across all instances and retries. */
const MAX_TOTAL_SEARCH_MS = 25_000

export type WebSearchResult = SearxngSearchResult

type SearchAdapter = {
  search: (
    instance: WebSearchInstance,
    query: WebSearchQuery,
    context: SearchContext,
  ) => Promise<WebSearchResult>
}

const SEARCH_ADAPTERS = {
  searxng: {
    search: (instance, query, context) =>
      searchSearxng(instance.url, query, context),
  },
} satisfies Record<SearchEngineId, SearchAdapter>

export async function searchWeb(
  input: WebSearchInput,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const deadline = Date.now() + MAX_TOTAL_SEARCH_MS
  const failures: string[] = []

  for (const instance of input.instances) {
    if (signal?.aborted) break
    if (Date.now() >= deadline) {
      failures.push(
        formatInstanceFailure(instance, 'search time budget exhausted'),
      )
      break
    }

    const adapter = SEARCH_ADAPTERS[instance.engine]
    try {
      return await adapter.search(instance, input, { signal, deadline })
    } catch (error) {
      failures.push(formatInstanceFailure(instance, error))
    }
  }

  throw new Error(`All web search instances failed. ${failures.join(' ')}`)
}

function formatInstanceFailure(
  instance: WebSearchInstance,
  error: unknown,
): string {
  return `${instance.engine} ${instance.url}: ${formatErrorMessage(error)}`
}
