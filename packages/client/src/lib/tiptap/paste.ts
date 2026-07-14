import type { Editor } from '@tiptap/react'

/**
 * Paste handler for editors that collapse paragraph spacing by serializing
 * blocks with single newlines (composer, prompt editor).
 * Single-line pastes and pastes inside code/dynamic blocks are left untouched.
 *
 * @returns true when it handled the paste.
 */
export function pasteCollapsedText(
  editor: Editor,
  event: ClipboardEvent,
): boolean {
  if (editor.state.selection.$from.parent.type.spec.code) return false

  const text = event.clipboardData?.getData('text/plain')
  if (!text || !/\r|\n/.test(text)) return false

  const markdown = text.replace(/\r\n?/g, '\n').replace(/\n/g, '\n\n')
  editor.commands.insertContent(markdown, { contentType: 'markdown' })
  return true
}
