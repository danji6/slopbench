/// <reference types="bun-types" />
import { fetchWeb } from '@sb/sidecar/mcp/fetch/web_fetch'
import { afterEach, describe, expect, test } from 'bun:test'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type FetchHandler = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) => Response

function mockFetch(handler: FetchHandler) {
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => handler(input, init),
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch
}

const ARTICLE_HTML = `<!doctype html>
<html>
  <head><title>Example Article</title></head>
  <body>
    <nav><a href="/home">NAVLINK Home</a><a href="/about">NAVLINK About</a></nav>
    <article>
      <h1>Understanding Web Fetching</h1>
      <p>Web fetching is the process of retrieving the contents of a page so it
      can be read by a program. A good fetcher removes navigation, scripts, and
      advertisements, returning only the meaningful body of the document.</p>
      <p>This second paragraph exists to give the readability algorithm enough
      text to confidently identify the main article content over the surrounding
      boilerplate elements on the page.</p>
    </article>
    <footer>NAVLINK Footer junk</footer>
  </body>
</html>`

describe('web fetch tool', () => {
  test('built-in reader returns clean markdown from HTML', async () => {
    mockFetch(
      () =>
        new Response(ARTICLE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    )

    const result = await fetchWeb({ url: 'https://example.com/article' })

    expect(result.source.engine).toBe('builtin')
    expect(result.title).toBe('Example Article')
    expect(result.markdown).toContain('Understanding Web Fetching')
    expect(result.markdown).toContain('Web fetching is the process')
    expect(result.markdown).not.toContain('NAVLINK')
  })

  test('returns non-HTML content as plain text', async () => {
    mockFetch(
      () =>
        new Response('plain text body', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    )

    const result = await fetchWeb({ url: 'https://example.com/robots.txt' })

    expect(result.source.engine).toBe('builtin')
    expect(result.markdown).toBe('plain text body')
  })

  test('treats empty extractions as failures', async () => {
    mockFetch(
      () =>
        new Response('<html><body><script>app()</script></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )

    const error = await fetchWeb({
      url: 'https://example.com/js-shell',
    }).catch((e: unknown) => (e instanceof Error ? e.message : String(e)))

    expect(error).toContain('Failed to fetch')
  })

  test('surfaces a clear error when the request fails', async () => {
    mockFetch(() => new Response('', { status: 403 }))

    const error = await fetchWeb({
      url: 'https://example.com/blocked',
    }).catch((e: unknown) => (e instanceof Error ? e.message : String(e)))

    expect(error).toContain('Failed to fetch')
    expect(error).toContain('403')
  })

  test('aborts when the caller signals', async () => {
    mockFetch(
      () =>
        new Response(ARTICLE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )

    await expect(
      fetchWeb({ url: 'https://example.com/article' }, AbortSignal.abort()),
    ).rejects.toThrow('aborted')
  })

  test('truncates markdown to max_length', async () => {
    mockFetch(
      () =>
        new Response('x'.repeat(5_000), {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    )

    const result = await fetchWeb({
      url: 'https://example.com/long.txt',
      max_length: 100,
    })

    expect(result.truncated).toBe(true)
    expect(result.markdown.length).toBe(100)
  })
})
