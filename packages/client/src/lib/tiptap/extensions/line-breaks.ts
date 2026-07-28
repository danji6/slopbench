import { openLineBlock } from '@/lib/tiptap/extensions/block-openers'
import { inTopLevelParagraph } from '@/lib/tiptap/lines'
import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/**
 * Makes a single Enter insert a line break rather than split the paragraph.
 * Pressing Enter twice still creates a paragraph break, and a line that opens
 * a block becomes that block instead (see {@link BlockOpeners}).
 */
export const LineBreaks = Extension.create({
  name: 'lineBreaks',
  // Below the interpreter (201) and code (200) handlers, above the base keymap
  priority: 150,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty || !inTopLevelParagraph($from)) return false

        if (openLineBlock(editor)) return true

        return editor.commands.setHardBreak()
      },

      // Backspace at the start of a paragraph takes the blank line away and
      // leaves the line break, and a second press joins the lines
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty || !inTopLevelParagraph($from)) return false
        if ($from.parentOffset !== 0 || $from.index(0) === 0) return false

        const previous = $from.node(0).child($from.index(0) - 1)
        if (previous.type.name !== 'paragraph' || previous.childCount === 0) {
          return false
        }

        const breakNode = state.schema.nodes.hardBreak
        if (!breakNode) return false

        const start = $from.before()
        return editor
          .chain()
          .command(({ tr }) => {
            tr.replaceWith(start - 1, start + 1, breakNode.create())
            // Leave the caret after the break, where the line now starts
            tr.setSelection(TextSelection.create(tr.doc, start))
            return true
          })
          .run()
      },
    }
  },
})
