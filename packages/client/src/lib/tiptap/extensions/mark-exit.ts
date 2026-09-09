import { type Editor, Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/** Leaves inline formatting when an arrow points out of its marked range. */
export const MarkExit = Extension.create({
  name: 'markExit',
  // Keep inline code's built-in exit shortcut ahead of this fallback
  priority: 50,
  addKeyboardShortcuts() {
    return {
      ArrowLeft: () => exitMarks(this.editor, -1),
      ArrowRight: () => exitMarks(this.editor, 1),
    }
  },
})

function exitMarks(editor: Editor, direction: -1 | 1): boolean {
  const { state } = editor
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  const { $from } = selection
  const adjacent = direction < 0 ? $from.nodeBefore : $from.nodeAfter
  const active = state.storedMarks ?? $from.marks()
  const remaining = active.filter((mark) => mark.isInSet(adjacent?.marks ?? []))
  if (remaining.length === active.length) return false

  // Change only the formatting of subsequent typing, leaving the text intact
  editor.view.dispatch(state.tr.setStoredMarks(remaining))
  return true
}
