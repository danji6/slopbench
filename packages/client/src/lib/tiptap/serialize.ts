import { formatMarkdown } from '@/lib/markdown/format'
import type { Editor } from '@tiptap/react'

/**
 * Serializes the editor to markdown, preserving the blank lines that separate
 * blocks.
 */
export function serializeDocumentToMarkdown(editor: Editor): string {
  return formatMarkdown(editor.getMarkdown())
}

/**
 * Serializes the editor to markdown with paragraph breaks collapsed into
 * single line breaks, so that Enter reads as a newline rather than a blank
 * line. Chat input only, it discards block spacing.
 */
export function serializeBlocksToMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manager = (editor.storage.markdown as any).manager
  const blocks: string[] = []
  editor.state.doc.forEach((node) => {
    const markdown: string = manager.serialize({
      type: 'doc',
      content: [node.toJSON()],
    })
    blocks.push(markdown.replace(/\n+$/, ''))
  })
  return formatMarkdown(blocks.join('\n'))
}

/** Replaces the editor content with the given markdown. */
export function setEditorMarkdown(editor: Editor, markdown: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manager = (editor.storage.markdown as any).manager
  const content = markdown ? manager.parse(markdown) : ''
  editor.commands.setContent(content)
}
