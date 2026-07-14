import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Fixes the caret landing on index 0 and leaving a dangling empty node when
 * deleting all text. Clears the content and moves the caret inside the
 * resulting block. Pass this to `editorProps.handleKeyDown`.
 *
 * @param {boolean} options.preserveBlock - clears the node's text instead of
 * removing it. For editors whose doc is a single wrapping node.
 *
 * @returns {boolean} True only when it handled the event.
 */
export function handleSelectAllDelete(
  view: EditorView,
  event: KeyboardEvent,
  options?: { preserveBlock?: boolean },
): boolean {
  if (event.key !== 'Backspace' && event.key !== 'Delete') {
    return false
  }

  const { state } = view
  const { from, to } = state.selection
  const size = state.doc.content.size

  if (from !== 0 || to !== size) return false

  const tr = options?.preserveBlock
    ? state.tr.delete(1, size - 1)
    : state.tr.delete(0, size)

  tr.setSelection(TextSelection.create(tr.doc, 1))
  view.dispatch(tr.scrollIntoView())

  return true
}
