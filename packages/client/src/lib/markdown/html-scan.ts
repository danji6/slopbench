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

type Token = Tag & { start: number }

/** A text scan, containing tags plus the close each open tag resolves to. */
type Scan = { tokens: Token[]; closes: number[] }

/** Outermost complete HTML elements, in document order. */
export function findHtmlSpans(text: string): HtmlSpan[] {
  const { tokens, closes } = scan(text)
  const spans: HtmlSpan[] = []
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]
    // A void or self-closing tag is its own end
    const close = token.empty ? i : closes[i]

    if (token.kind !== 'open' || !allowedTags.has(token.name) || close === -1) {
      i++
      continue
    }

    const end = tokens[close].end
    spans.push({ start: token.start, end, html: text.slice(token.start, end) })
    i = close + 1
  }

  return spans
}

/** Whether every top level tag in a run of text is one the sanitizer keeps. */
export function hasOnlyAllowedTags(text: string): boolean {
  const { tokens, closes } = scan(text)
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]
    if (token.kind === 'comment') {
      i++
      continue
    }
    if (!allowedTags.has(token.name)) return false

    // A closed element's content is nested, not top level
    const closed = token.kind === 'open' && !token.empty && closes[i] !== -1
    i = closed ? closes[i] + 1 : i + 1
  }

  return true
}

/**
 * Escapes the tags the sanitizer would strip. Also prevents nested tags from
 * getting removed.
 */
export function escapeUnknownTags(text: string): string {
  const { tokens } = scan(text)
  let out = ''
  let at = 0

  for (const token of tokens) {
    if (token.kind === 'comment' || allowedTags.has(token.name)) continue
    const tag = text.slice(token.start, token.end)
    out += text.slice(at, token.start) + escapeHtml(tag)
    at = token.end
  }

  return out + text.slice(at)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

/** Tokenizes text and pairs every open tag with its close. */
function scan(text: string): Scan {
  const tokens: Token[] = []
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

    tokens.push({ ...tag, start: i })
    i = tag.end
  }

  return { tokens, closes: pairTokens(tokens) }
}

/** The close token index for each open token, or -1 when it never closes. */
function pairTokens(tokens: Token[]): number[] {
  const closes = new Array<number>(tokens.length).fill(-1)
  const stack: number[] = [] // token indexes of the currently open tags
  const positions = new Map<string, number[]>() // tag name -> stack positions

  const drop = (at: number) => {
    const open = positions.get(tokens[stack[at]].name)
    if (open?.at(-1) === at) open.pop()
  }

  for (const [i, token] of tokens.entries()) {
    if (token.kind === 'open' && !token.empty) {
      const open = positions.get(token.name) ?? []
      open.push(stack.length)
      positions.set(token.name, open)
      stack.push(i)
      continue
    }
    if (token.kind !== 'close') continue

    const at = positions.get(token.name)?.pop()
    if (at === undefined) continue

    closes[stack[at]] = i
    for (let s = stack.length - 1; s > at; s--) drop(s)
    stack.length = at
  }

  return closes
}
