import type { MarkdownToken } from '@tiptap/core'
import { MarkdownManager, Markdown as TiptapMarkdown } from '@tiptap/markdown'

type TextEncoder = { encodeTextForMarkdown: (text: string) => string }

type TokenParser = {
  parseTokens: (
    tokens: MarkdownToken[],
    implicitParagraphs?: boolean,
  ) => unknown
}

type HtmlDetector = {
  isUnrecognizedHtml: (html: string) => boolean
  getSchemaParseDomTags: () => Set<string>
}

/** Matches every opening/closing tag name in a raw HTML chunk. */
const HTML_TAG = /<\/?([a-zA-Z][\w-]*)/g

/** Matches a run of two or more line breaks at the end of a token's raw text. */
const TRAILING_BLANK_LINES = /\n[^\S\n]*(?:\n[^\S\n]*)+$/

/**
 * Drops the serializer's text encoding to avoid persisting encoded html.
 * The encoding would otherwise corrupt the payload:
 * - `<tag>` becomes `&lt;tag&gt;`
 * - `run_id` becomes `run\_id`
 * - `C:\path` becomes `C:\\path`
 */
export function serializeTextLiterally(target: MarkdownManager): void {
  ;(target as unknown as TextEncoder).encodeTextForMarkdown = (text) => text
}

/**
 * Keeps undeclared custom elements as literal text when parsing markdown.
 * Without this, tags like `<system-reminder>` would be dropped silently.
 * Custom elements no extension declares a parse rule for are kept as-is.
 */
export function keepUnknownHtmlLiteral(target: MarkdownManager): void {
  const detector = target as unknown as HtmlDetector
  const isUnrecognized = detector.isUnrecognizedHtml

  detector.isUnrecognizedHtml = function (this: HtmlDetector, html: string) {
    if (isUnrecognized.call(this, html)) return true

    const declared = this.getSchemaParseDomTags()
    return [...html.matchAll(HTML_TAG)].some(
      ([, tag]) => tag.includes('-') && !declared.has(tag.toLowerCase()),
    )
  }
}

/**
 * Splits blank lines absorbed into a block token's `raw` back out into an
 * explicit `space` token, which is the only thing empty paragraphs are
 * reconstructed from.
 */
function extractAbsorbedBlankLines(tokens: MarkdownToken[]): MarkdownToken[] {
  return tokens.flatMap((token, index) => {
    // A following space token already carries the blank lines for this gap
    if (token.type === 'space' || tokens[index + 1]?.type === 'space') {
      return [token]
    }

    const raw: string = token.raw ?? ''
    const absorbed = raw.match(TRAILING_BLANK_LINES)
    if (!absorbed) return [token]

    return [
      { ...token, raw: raw.slice(0, -absorbed[0].length) },
      { type: 'space', raw: absorbed[0] } as MarkdownToken,
    ]
  })
}

/**
 * Restores the blank line that follows a block-level tag.
 *
 * This mirrors TipTap's upstream `9af2f2b1e`, which is not in a published
 * release yet at the time of writing this. It is idempotent, so it stays
 * harmless once that's released.
 */
export function recoverAbsorbedBlankLines(target: MarkdownManager): void {
  const parser = target as unknown as TokenParser
  const parseTokens = parser.parseTokens

  parser.parseTokens = function (
    this: TokenParser,
    tokens,
    implicitParagraphs,
  ) {
    return parseTokens.call(
      this,
      implicitParagraphs ? extractAbsorbedBlankLines(tokens) : tokens,
      implicitParagraphs,
    )
  }
}

// Patched on the prototype rather than the editor. Tiptap builds its manager
// and parses the editor's initial markdown in the same `onBeforeCreate`. An
// instance patched after that hook would miss the first parse entirely.
serializeTextLiterally(MarkdownManager.prototype)
keepUnknownHtmlLiteral(MarkdownManager.prototype)
recoverAbsorbedBlankLines(MarkdownManager.prototype)

/**
 * Markdown support that stores exactly what was typed, matching how assistant
 * authored content is persisted.
 *
 * Editors must import this rather than `@tiptap/markdown`'s extension to make
 * use of the patches above.
 */
export const Markdown = TiptapMarkdown
