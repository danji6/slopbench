import { isWholeHtml } from '@/lib/markdown/html-scan'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'

type InlineParser = {
  parseInlineTokens: (tokens: MarkdownToken[]) => JSONContent[]
  tokenizeInline: (source: string) => MarkdownToken[]
}

const LINE_MARKS = new Set(['em', 'strong', 'del'])

/** Prevents a closing delimiter on a later line from opening inline formatting. */
export function keepMarksOnOneLine(target: MarkdownManager): void {
  const parser = target as unknown as InlineParser
  const parseInlineTokens = parser.parseInlineTokens
  parser.parseInlineTokens = function (tokens) {
    const lines = tokens.flatMap((token) => {
      if (!LINE_MARKS.has(token.type ?? '') || !token.raw?.includes('\n')) {
        return [token]
      }
      return token.raw
        .split('\n')
        .flatMap((line, index) => [
          ...(index ? [{ type: 'text', raw: '\n', text: '\n' }] : []),
          ...this.tokenizeInline(line),
        ])
    })
    return parseInlineTokens.call(this, lines)
  }
}

/** Represents paragraph separators as real blank lines the caret can occupy. */
export function editableMarkdownLines(
  doc: JSONContent,
  collapseBlocks: boolean,
): JSONContent {
  return { ...doc, content: joinParagraphs(doc.content ?? [], collapseBlocks) }
}

/** Joins adjacent prose paragraphs with their double newline markdown separator. */
function joinParagraphs(
  nodes: JSONContent[],
  collapseBlocks: boolean,
): JSONContent[] {
  const result: JSONContent[] = []
  for (const node of nodes) {
    const previous = result.at(-1)
    if (!isProse(node)) {
      result.push(node)
    } else if (previous && isProse(previous)) {
      previous.content = [
        ...(previous.content ?? []),
        { type: 'hardBreak' },
        ...(!collapseBlocks ? [{ type: 'hardBreak' }] : []),
        ...explicitBreaks(node.content ?? []),
      ]
    } else {
      result.push({ ...node, content: explicitBreaks(node.content ?? []) })
    }
  }
  return result
}

/** Leaves standalone HTML previews in their own block. */
function isProse(node: JSONContent): boolean {
  if (node.type !== 'paragraph') return false
  const text = (node.content ?? []).map((child) => child.text ?? '\n').join('')
  return !isWholeHtml(text)
}

/** Gives parsed newlines the same document representation as pressing Enter. */
function explicitBreaks(nodes: JSONContent[]): JSONContent[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'text' || !node.text?.includes('\n')) return [node]
    return node.text
      .split('\n')
      .flatMap((text, index) => [
        ...(index ? [{ type: 'hardBreak' }] : []),
        ...(text ? [{ ...node, text }] : []),
      ])
  })
}
