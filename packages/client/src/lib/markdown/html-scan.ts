import { allowedTags } from './sanitize'

/** A complete HTML element found in a run of text. */
export type HtmlSpan = { start: number; end: number; html: string }

const OPEN_TAG =
  /<([a-zA-Z][\w.-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y
const CLOSE_TAG = /<\/([a-zA-Z][\w.-]*)\s*>/y
const COMMENT = /<!--[\s\S]*?-->/y

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

type Tag = {
  kind: 'open' | 'close' | 'comment'
  name: string
  end: number
  empty: boolean
}

/** Outermost complete HTML elements in a run of text, in document order. */
export function findHtmlSpans(text: string): HtmlSpan[] {
  const spans: HtmlSpan[] = []
  let i = 0

  while (i < text.length) {
    if (text[i] !== '<') {
      i++
      continue
    }

    const tag = matchTag(text, i)
    if (tag?.kind === 'comment') {
      i = tag.end
      continue
    }
    if (!tag || tag.kind !== 'open' || !allowedTags.has(tag.name)) {
      i++
      continue
    }

    const end = tag.empty ? tag.end : findClose(text, tag.end, tag.name)
    if (end === -1) {
      i++
      continue
    }

    spans.push({ start: i, end, html: text.slice(i, end) })
    i = end
  }

  return spans
}

/** Whether every top level tag in a run of text is one the sanitizer keeps. */
export function hasOnlyAllowedTags(text: string): boolean {
  let i = 0

  while (i < text.length) {
    if (text[i] !== '<') {
      i++
      continue
    }

    const tag = matchTag(text, i)
    if (!tag) {
      i++
      continue
    }
    if (tag.kind !== 'comment' && !allowedTags.has(tag.name)) return false

    if (tag.kind === 'open' && !tag.empty) {
      const close = findClose(text, tag.end, tag.name)
      i = close === -1 ? tag.end : close
      continue
    }
    i = tag.end
  }

  return true
}

/** Whether `text` is exactly one HTML element end to end. */
export function isWholeHtml(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const [span, ...rest] = findHtmlSpans(trimmed)
  return !!span && rest.length === 0 && span.end - span.start === trimmed.length
}

/** The tag token starting exactly at `i`, or null when there is none. */
function matchTag(text: string, i: number): Tag | null {
  COMMENT.lastIndex = i
  const comment = COMMENT.exec(text)
  if (comment) {
    return { kind: 'comment', name: '', end: COMMENT.lastIndex, empty: true }
  }

  CLOSE_TAG.lastIndex = i
  const close = CLOSE_TAG.exec(text)
  if (close) {
    return {
      kind: 'close',
      name: close[1].toLowerCase(),
      end: CLOSE_TAG.lastIndex,
      empty: true,
    }
  }

  OPEN_TAG.lastIndex = i
  const open = OPEN_TAG.exec(text)
  if (!open) return null

  const name = open[1].toLowerCase()
  return {
    kind: 'open',
    name,
    end: OPEN_TAG.lastIndex,
    empty: open[3] === '/' || VOID_TAGS.has(name),
  }
}

/** Index just past the close tag matching `name`, or -1 if not found. */
function findClose(text: string, from: number, name: string): number {
  let depth = 1
  let i = from

  while (i < text.length) {
    if (text[i] !== '<') {
      i++
      continue
    }

    const tag = matchTag(text, i)
    if (!tag) {
      i++
      continue
    }

    if (tag.name === name) {
      if (tag.kind === 'open' && !tag.empty) depth++
      else if (tag.kind === 'close' && --depth === 0) return tag.end
    }
    i = tag.end
  }

  return -1
}
