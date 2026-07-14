import type { WebSearchQuery } from '@sb/core/types'

import {
  type RequestContext,
  boundedDelay,
  formatErrorMessage,
  isRetryableStatus,
  retryDelayMs,
  wait,
  withTimeout,
} from './http'

const DEFAULT_MAX_RESULTS = 8
const SEARCH_TIMEOUT_MS = 10_000
const MAX_SEARCH_ATTEMPTS = 3

export type SearchContext = RequestContext

export { formatErrorMessage }

export type SearxngSearchResult = ReturnType<typeof normalizeSearchResponse>

type SearxngResponse = {
  query?: unknown
  number_of_results?: unknown
  results?: unknown
  answers?: unknown
  corrections?: unknown
  infoboxes?: unknown
  suggestions?: unknown
  unresponsive_engines?: unknown
}

export async function searchSearxng(
  rawUrl: string,
  input: WebSearchQuery,
  context: SearchContext,
): Promise<SearxngSearchResult> {
  const baseUrl = normalizeSearxngUrl(rawUrl)
  const url = buildSearchUrl(baseUrl, input)
  const response = await fetchSearchWithRetries(url, context)

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(formatSearxngHttpError(response.status))
  }

  const data = (await response.json()) as SearxngResponse
  return normalizeSearchResponse(data, baseUrl, input)
}

async function fetchSearchWithRetries(
  url: string,
  { signal, deadline }: SearchContext,
): Promise<Response> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      lastError ??= new Error('search time budget exhausted')
      break
    }

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'chat-searxng/1.0',
        },
        signal: withTimeout(signal, Math.min(SEARCH_TIMEOUT_MS, remaining)),
      })

      if (
        response.ok ||
        !isRetryableStatus(response.status) ||
        attempt === MAX_SEARCH_ATTEMPTS
      ) {
        return response
      }

      await response.body?.cancel().catch(() => {})
      await wait(boundedDelay(retryDelayMs(response, attempt), deadline))
    } catch (error) {
      lastError = error
      // The caller aborted (not just a per-attempt timeout): stop immediately.
      if (signal?.aborted) break
      if (attempt === MAX_SEARCH_ATTEMPTS) break
      await wait(boundedDelay(retryDelayMs(undefined, attempt), deadline))
    }
  }

  throw new Error(formatSearchFailure(lastError))
}

export function normalizeSearxngUrl(value: string): string {
  const url = new URL(value.trim())
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

function buildSearchUrl(baseUrl: string, input: WebSearchQuery): string {
  const url = new URL(`${baseUrl}/search`)
  url.searchParams.set('q', input.query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('pageno', String(input.page ?? 1))

  if (input.category) url.searchParams.set('categories', input.category)
  if (input.language) url.searchParams.set('language', input.language)
  if (input.time_range) url.searchParams.set('time_range', input.time_range)
  if (input.safesearch !== undefined) {
    url.searchParams.set('safesearch', String(input.safesearch))
  }

  return url.toString()
}

function formatSearxngHttpError(status: number): string {
  if (status === 403) {
    return 'SearXNG returned 403. The instance may not have JSON output enabled in search.formats.'
  }
  if (status === 429) {
    return 'SearXNG returned 429 after retries. The instance is rate limiting search requests.'
  }
  return `SearXNG search failed with HTTP ${status}.`
}

function formatSearchFailure(error: unknown): string {
  return `SearXNG search failed after retries: ${formatErrorMessage(error)}`
}

function normalizeSearchResponse(
  data: SearxngResponse,
  searxngUrl: string,
  input: WebSearchQuery,
) {
  const maxResults = input.max_results ?? DEFAULT_MAX_RESULTS
  return {
    query: stringValue(data.query) ?? input.query,
    number_of_results: numberValue(data.number_of_results),
    results: arrayValue(data.results)
      .map(normalizeResult)
      .filter((result) => result.title && result.url)
      .slice(0, maxResults),
    answers: arrayValue(data.answers).map(compactValue),
    corrections: arrayValue(data.corrections).map(compactValue),
    infoboxes: arrayValue(data.infoboxes).map(compactValue),
    suggestions: arrayValue(data.suggestions).map(compactValue),
    unresponsive_engines: arrayValue(data.unresponsive_engines).map(
      compactValue,
    ),
    source: { engine: 'searxng' as const, url: searxngUrl },
  }
}

function normalizeResult(value: unknown) {
  const record = recordValue(value)
  return {
    title: stringValue(record.title) ?? '',
    url: stringValue(record.url) ?? '',
    content: stringValue(record.content),
    engine: stringValue(record.engine),
    engines: arrayValue(record.engines).map(compactValue).filter(isString),
    category: stringValue(record.category),
    publishedDate: stringValue(record.publishedDate),
    img_src: stringValue(record.img_src),
    thumbnail:
      stringValue(record.thumbnail) ?? stringValue(record.thumbnail_src),
  }
}

function compactValue(value: unknown): unknown {
  if (typeof value === 'string' || typeof value === 'number') return value
  const record = recordValue(value)
  const keys = [
    'answer',
    'content',
    'infobox',
    'title',
    'url',
    'engine',
    'engines',
    'suggestion',
    'correction',
  ]
  const compact: Record<string, unknown> = {}
  for (const key of keys) {
    if (record[key] !== undefined) compact[key] = record[key]
  }
  return Object.keys(compact).length > 0 ? compact : value
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
