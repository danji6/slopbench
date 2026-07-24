import { leafText } from '@/lib/tiptap/serialize'
import type { Slice } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

/**
 * Clipboard text that matches how an editor stores its content. Hard breaks are
 * newlines, and blocks are separated by whatever that editor writes between them.
 */
const clipboardText = (blockSeparator: string) => (slice: Slice) =>
  slice.content.textBetween(0, slice.content.size, blockSeparator, leafText)

/** For editors that store a block break as a newline (chat composer). */
export const copyCollapsedText = clipboardText('\n')

/** For editors that store a block break as a blank line (prompt editor). */
export const copyBlockText = clipboardText('\n\n')

/** Pasted plain text, or null when the default paste should run instead. */
function pastedText(editor: Editor, event: ClipboardEvent): string | null {
  if (editor.state.selection.$from.parent.type.spec.code) return null
  const text = event.clipboardData?.getData('text/plain')
  if (!text || !/\r|\n/.test(text)) return null
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Paste handler for editors that collapse paragraph spacing by serializing
 * blocks with single newlines (composer).
 *
 * @returns true when it handled the paste.
 */
export function pasteCollapsedText(
  editor: Editor,
  event: ClipboardEvent,
): boolean {
  const text = pastedText(editor, event)
  if (text === null) return false

  editor.commands.insertContent(text.replace(/\n/g, '\n\n'), {
    contentType: 'markdown',
  })
  return true
}

/**
 * Paste handler for editors where a line break is still a line break (prompt
 * editor).
 *
 * @returns true when it handled the paste.
 */
export function pasteTextLines(editor: Editor, event: ClipboardEvent): boolean {
  const text = pastedText(editor, event)
  if (text === null) return false

  editor.commands.insertContent(text, { contentType: 'markdown' })
  return true
}
