import type { Editor } from '@tiptap/react'

/** Whether the clipboard contains a slice written by an editor. */
function hasEditorSlice(event: ClipboardEvent): boolean {
  const html = event.clipboardData?.getData('text/html')
  return !!html?.includes('data-pm-slice')
}

/** Pasted plain text, or null when the default paste should run instead. */
function pastedText(editor: Editor, event: ClipboardEvent): string | null {
  if (editor.state.selection.$from.parent.type.spec.code) return null
  if (hasEditorSlice(event)) return null
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
