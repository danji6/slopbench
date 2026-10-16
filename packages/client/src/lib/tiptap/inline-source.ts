import { findHtmlSpans } from '@/lib/markdown/html-scan'
import { scanInterpreterSyntax } from '@/lib/tiptap/interpreter-syntax'
import type { PositionRange } from '@/lib/tiptap/lines'
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownToken,
} from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'
import type { Node, ResolvedPos } from '@tiptap/pm/model'

export const SOURCE_DELIMITERS = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
} as const

export type SourceFormat = keyof typeof SOURCE_DELIMITERS

export type SourceSpan = {
  format: SourceFormat
  from: number
  to: number
  contentFrom: number
  contentTo: number
}

/** Returns the delimiter characters, including code span padding. */
export function sourceDelimiterRanges(spans: SourceSpan[]): PositionRange[] {
  return spans.flatMap((span) => [
    { from: span.from, to: span.contentFrom },
    { from: span.contentTo, to: span.to },
  ])
}

type InlineLexer = { tokenizeInline: (source: string) => MarkdownToken[] }
const TOKEN_FORMATS: Record<string, SourceFormat> = {
  strong: 'bold',
  em: 'italic',
  del: 'strike',
  codespan: 'code',
}

/** Checks whether a native mark has an editable Markdown representation. */
export function isSourceFormat(name: string): name is SourceFormat {
  return Object.hasOwn(SOURCE_DELIMITERS, name)
}

/** Tokenizes with the editor's configured lexer, including its math policy. */
export function inlineTokens(
  manager: MarkdownManager,
  text: string,
): MarkdownToken[] {
  return (manager as unknown as InlineLexer).tokenizeInline(text)
}

/** Keeps delimiters while allowing links and other inline children to parse normally. */
export function parseSourceMark(
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
): JSONContent[] {
  const raw = token.raw ?? ''
  if (token.type === 'codespan') return [{ type: 'text', text: raw }]
  const size = delimiterSize(token)
  return [
    { type: 'text', text: raw.slice(0, size) },
    ...helpers.parseInline(token.tokens ?? []),
    { type: 'text', text: raw.slice(-size) },
  ]
}

function delimiterSize(token: MarkdownToken): number {
  if (token.type === 'strong') return 2
  if (token.type === 'codespan') {
    return /^`+/.exec(token.raw ?? '')?.[0].length ?? 1
  }
  if (token.type === 'del') return /^~+/.exec(token.raw ?? '')?.[0].length ?? 2
  return 1
}

/** Finds supported formatting with offsets into the original source. */
export function scanInlineSource(
  manager: MarkdownManager,
  text: string,
): SourceSpan[] {
  const spans: SourceSpan[] = []
  walkTokens(manager, inlineTokens(manager, text), 0, spans)
  const protectedRanges = [
    ...findHtmlSpans(text).map((span) => ({ from: span.start, to: span.end })),
    ...scanInterpreterSyntax(text).filter((token) => token.kind === 'code'),
  ]
  return spans.filter(
    (span) =>
      !protectedRanges.some(
        (range) => span.from >= range.from && span.to <= range.to,
      ),
  )
}

function walkTokens(
  manager: MarkdownManager,
  tokens: MarkdownToken[],
  start: number,
  spans: SourceSpan[],
): void {
  let offset = start
  for (const token of tokens) {
    const raw = token.raw ?? ''
    const format = TOKEN_FORMATS[token.type ?? '']
    if (format && format !== 'code' && raw.includes('\n')) {
      let lineStart = offset
      for (const line of raw.split('\n')) {
        walkTokens(manager, inlineTokens(manager, line), lineStart, spans)
        lineStart += line.length + 1
      }
    } else if (format) {
      const size = delimiterSize(token)
      const body = raw.slice(size, -size)
      const paddedCode =
        format === 'code' &&
        body.startsWith(' ') &&
        body.endsWith(' ') &&
        body.trim().length > 0
      const padding = paddedCode ? 1 : 0
      spans.push({
        format,
        from: offset,
        to: offset + raw.length,
        contentFrom: offset + size + padding,
        contentTo: offset + raw.length - size - padding,
      })
      if (format !== 'code') {
        walkTokens(manager, token.tokens ?? [], offset + size, spans)
      }
    }
    // Links are already native marks; scanning their labels never reveals destinations
    offset += raw.length
  }
}

/** Reads a text block without losing offsets at hard breaks or inline atoms. */
export function sourceBlockText(node: Node): string {
  return node.textBetween(0, node.content.size, '', '\n')
}

/** Detects inline source code for keyboard rules and competing previews. */
export function inSourceCode(
  $pos: ResolvedPos,
  manager?: MarkdownManager,
): boolean {
  if ($pos.marks().some((mark) => mark.type.spec.code)) return true
  if (!manager || !$pos.parent.isTextblock || $pos.parent.type.spec.code) {
    return false
  }
  return scanInlineSource(manager, sourceBlockText($pos.parent)).some(
    (span) =>
      span.format === 'code' &&
      $pos.parentOffset >= span.contentFrom &&
      $pos.parentOffset <= span.contentTo,
  )
}

/** Maps a block's source spans to document positions. Unchanged blocks reuse their parse. */
export function collectSourceSpans(
  doc: Node,
  manager: MarkdownManager,
  cache = new WeakMap<Node, SourceSpan[]>(),
): SourceSpan[] {
  const spans: SourceSpan[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return
    let local = cache.get(node)
    if (!local) {
      local = scanInlineSource(manager, sourceBlockText(node))
      cache.set(node, local)
    }
    for (const span of local) {
      const base = pos + 1
      spans.push({
        ...span,
        from: base + span.from,
        to: base + span.to,
        contentFrom: base + span.contentFrom,
        contentTo: base + span.contentTo,
      })
    }
    return false
  })
  return spans
}
