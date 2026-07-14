import type { WebFetchQuery } from '@sb/core/types'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

import { type RequestContext, withTimeout } from '../http'
import type { WebFetchResult } from './web_fetch'

const BUILTIN_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})
turndown.remove(['script', 'style', 'noscript', 'template', 'iframe'])

export async function fetchBuiltin(
  input: WebFetchQuery,
  { signal, deadline }: RequestContext,
): Promise<WebFetchResult> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('fetch time budget exhausted')

  const response = await fetch(input.url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    redirect: 'follow',
    signal: withTimeout(signal, Math.min(BUILTIN_TIMEOUT_MS, remaining)),
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`request failed with HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const body = await response.text()

  if (!contentType.includes('html')) {
    return {
      url: input.url,
      markdown: body.trim(),
      source: { engine: 'builtin' },
    }
  }

  return extractFromHtml(input.url, body)
}

function extractFromHtml(url: string, html: string): WebFetchResult {
  const { document } = parseHTML(html)
  const article = new Readability(document).parse()

  const contentHtml = article?.content || document.body?.innerHTML || html
  const markdown = turndown.turndown(contentHtml).trim()

  return {
    url,
    title: article?.title || document.title || undefined,
    markdown,
    source: { engine: 'builtin' },
  }
}
