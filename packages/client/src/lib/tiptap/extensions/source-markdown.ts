import { Markdown } from '@/lib/tiptap/extensions/markdown'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'

type InlineParser = {
  parseInlineTokens: (tokens: MarkdownToken[]) => JSONContent[]
}

/** Preserves escapes so a literal asterisk cannot become formatting after reopening. */
function preserveEscapes(manager: MarkdownManager): void {
  const parser = manager as unknown as InlineParser
  const parse = parser.parseInlineTokens
  parser.parseInlineTokens = function (tokens) {
    return parse.call(
      this,
      tokens.map((token) =>
        token.type === 'escape'
          ? { ...token, type: 'text', text: token.raw }
          : token,
      ),
    )
  }
}

/** Keeps editable inline source in the shared Markdown editors. */
export const SourceMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    const { content, contentType } = this.editor.options
    this.parent?.(event)
    const manager = this.editor.markdown
    if (!manager) return
    preserveEscapes(manager)
    // The parent's first parse precedes our instance-level escape handling
    if (typeof content === 'string' && contentType === 'markdown') {
      const parsed = manager.parse(content)
      this.editor.options.content = parsed.content?.length ? parsed : ''
    }
  },
})
