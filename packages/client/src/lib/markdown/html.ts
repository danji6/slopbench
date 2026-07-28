import type { Nodes } from 'hast'
import rehypeParse from 'rehype-parse'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'

import { sanitizeSchema } from './sanitize'

const processor = unified()
  // `fragment` keeps parse5 from wrapping the input in html/head/body
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify)

const cache = new Map<string, string>()
const MAX_ENTRIES = 1000

/** Elements that are visible without holding any text of their own. */
const SELF_SUFFICIENT = new Set([
  'br',
  'hr',
  'img',
  'input',
  'picture',
  'source',
])

/**
 * Raw HTML rendered through the same sanitizer the message renderer uses.
 *
 * Returns `''` when nothing visible survives sanitizing.
 */
export function renderSanitizedHtml(raw: string): string {
  const cached = cache.get(raw)
  if (cached !== undefined) return cached

  const tree = processor.runSync(processor.parse(raw))
  const html = hasVisibleContent(tree) ? processor.stringify(tree) : ''

  if (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(raw, html)
  return html
}

/** Whether a sanitized tree renders anything the reader can actually see. */
function hasVisibleContent(node: Nodes): boolean {
  if (node.type === 'text') return node.value.trim().length > 0
  if (node.type === 'element' && SELF_SUFFICIENT.has(node.tagName)) return true
  if (!('children' in node)) return false
  return node.children.some(hasVisibleContent)
}
