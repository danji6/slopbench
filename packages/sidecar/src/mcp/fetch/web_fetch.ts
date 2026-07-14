import type { WebFetchQuery } from '@sb/core/types'
import { MAX_WEB_FETCH_LENGTH } from '@sb/core/types'

import { type RequestContext, formatErrorMessage } from '../http'
import { fetchBuiltin } from './builtin'

/** Overall time budget for a fetch across retries. */
const MAX_TOTAL_FETCH_MS = 25_000

export type WebFetchResult = {
  url: string
  title?: string
  markdown: string
  truncated?: boolean
  source: { engine: 'builtin' }
}

export async function fetchWeb(
  input: WebFetchQuery,
  signal?: AbortSignal,
): Promise<WebFetchResult> {
  if (signal?.aborted) throw new Error('Web fetch aborted.')

  const deadline = Date.now() + MAX_TOTAL_FETCH_MS
  const context: RequestContext = { signal, deadline }

  try {
    return finalize(await fetchBuiltin(input, context), input)
  } catch (error) {
    if (signal?.aborted) throw new Error('Web fetch aborted.', { cause: error })
    throw new Error(
      `Failed to fetch ${input.url}. ${formatErrorMessage(error)}`,
      { cause: error },
    )
  }
}

/** Reject empty extractions and apply the max_length cap. */
function finalize(
  result: WebFetchResult,
  input: WebFetchQuery,
): WebFetchResult {
  if (!result.markdown.trim()) {
    throw new Error('returned no readable content')
  }

  const limit = input.max_length ?? MAX_WEB_FETCH_LENGTH
  if (result.markdown.length <= limit) return result
  return {
    ...result,
    markdown: result.markdown.slice(0, limit),
    truncated: true,
  }
}
