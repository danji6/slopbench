/// <reference types="bun-types" />
import { normalizeSearxngUrl } from '@sb/sidecar/mcp/searxng'
import { searchWeb } from '@sb/sidecar/mcp/web_search'
import { afterEach, describe, expect, test } from 'bun:test'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(handler: (input: Parameters<typeof fetch>[0]) => Response) {
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => handler(input),
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch
}

describe('web search SearXNG adapter', () => {
  test('normalizes instance URLs', () => {
    expect(normalizeSearxngUrl('https://search.example.com/')).toBe(
      'https://search.example.com',
    )
    expect(normalizeSearxngUrl('https://example.com/searxng/?q=old#hash')).toBe(
      'https://example.com/searxng',
    )
  })

  test('sends SearXNG API parameters and compacts results', async () => {
    const requestUrls: URL[] = []
    mockFetch((input) => {
      requestUrls.push(new URL(String(input)))
      return new Response(
        JSON.stringify({
          query: 'convex ai',
          number_of_results: 42,
          results: [
            {
              title: 'Convex',
              url: 'https://convex.dev',
              content: 'Backend platform',
              parsed_url: ['https', 'convex.dev'],
              engines: ['duckduckgo', 'brave'],
              category: 'general',
            },
            { title: 'Missing URL' },
          ],
          answers: ['direct answer'],
          suggestions: ['convex docs'],
          unresponsive_engines: [['google', 'timeout']],
        }),
        { status: 200 },
      )
    })

    const result = await searchWeb({
      instances: [{ engine: 'searxng', url: 'https://search.example.com/' }],
      query: 'convex ai',
      category: 'general',
      language: 'en-US',
      time_range: 'month',
      safesearch: 1,
      page: 2,
      max_results: 5,
    })

    const requestUrl = requestUrls[0]
    expect(requestUrl.pathname).toBe('/search')
    expect(requestUrl.searchParams.get('q')).toBe('convex ai')
    expect(requestUrl.searchParams.get('format')).toBe('json')
    expect(requestUrl.searchParams.get('categories')).toBe('general')
    expect(requestUrl.searchParams.get('language')).toBe('en-US')
    expect(requestUrl.searchParams.get('time_range')).toBe('month')
    expect(requestUrl.searchParams.get('safesearch')).toBe('1')
    expect(requestUrl.searchParams.get('pageno')).toBe('2')

    expect(result).toMatchObject({
      query: 'convex ai',
      number_of_results: 42,
      results: [
        {
          title: 'Convex',
          url: 'https://convex.dev',
          content: 'Backend platform',
          engines: ['duckduckgo', 'brave'],
          category: 'general',
        },
      ],
      answers: ['direct answer'],
      suggestions: ['convex docs'],
      source: { engine: 'searxng', url: 'https://search.example.com' },
    })
  })

  test('explains disabled JSON output errors', async () => {
    mockFetch(() => new Response('', { status: 403 }))

    await expect(
      searchWeb({
        instances: [{ engine: 'searxng', url: 'https://search.example.com' }],
        query: 'test',
      }),
    ).rejects.toThrow('JSON output enabled')
  })

  test('retries rate limited requests and honors retry-after', async () => {
    let calls = 0
    mockFetch(() => {
      calls += 1
      if (calls === 1) {
        return new Response('', {
          status: 429,
          headers: { 'retry-after': '0' },
        })
      }
      return new Response(JSON.stringify({ query: 'test', results: [] }), {
        status: 200,
      })
    })

    await expect(
      searchWeb({
        instances: [{ engine: 'searxng', url: 'https://search.example.com' }],
        query: 'test',
      }),
    ).resolves.toMatchObject({ query: 'test', results: [] })
    expect(calls).toBe(2)
  })

  test('returns a clear error when rate limiting persists', async () => {
    let calls = 0
    mockFetch(() => {
      calls += 1
      return new Response('', {
        status: 429,
        headers: { 'retry-after': '0' },
      })
    })

    await expect(
      searchWeb({
        instances: [{ engine: 'searxng', url: 'https://search.example.com' }],
        query: 'test',
      }),
    ).rejects.toThrow('rate limiting search requests')
    expect(calls).toBe(3)
  })

  test('falls back to the next instance after one fails', async () => {
    const requestUrls: string[] = []
    mockFetch((input) => {
      const url = new URL(String(input))
      requestUrls.push(url.origin)
      if (url.origin === 'https://busy.example.com') {
        return new Response('', {
          status: 429,
          headers: { 'retry-after': '0' },
        })
      }
      return new Response(
        JSON.stringify({
          query: 'test',
          results: [{ title: 'Result', url: 'https://result.example.com' }],
        }),
        { status: 200 },
      )
    })

    await expect(
      searchWeb({
        instances: [
          { engine: 'searxng', url: 'https://busy.example.com' },
          { engine: 'searxng', url: 'https://search.example.com' },
        ],
        query: 'test',
      }),
    ).resolves.toMatchObject({
      results: [{ title: 'Result', url: 'https://result.example.com' }],
      source: { url: 'https://search.example.com' },
    })
    expect(requestUrls).toEqual([
      'https://busy.example.com',
      'https://busy.example.com',
      'https://busy.example.com',
      'https://search.example.com',
    ])
  })

  test('short-circuits when the caller aborts before fetching', async () => {
    let calls = 0
    mockFetch(() => {
      calls += 1
      return new Response(JSON.stringify({ query: 'test', results: [] }), {
        status: 200,
      })
    })

    await expect(
      searchWeb(
        {
          instances: [{ engine: 'searxng', url: 'https://search.example.com' }],
          query: 'test',
        },
        AbortSignal.abort(),
      ),
    ).rejects.toThrow('All web search instances failed')
    expect(calls).toBe(0)
  })
})
