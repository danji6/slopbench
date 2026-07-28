import {
  type PositionRange,
  caretLine,
  inTopLevelParagraph,
} from '@/lib/tiptap/lines'
import { Extension } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

/** Line contents that open a block. */
const BLOCK_OPENERS = [
  /^#{1,6}\s$/, // heading
  /^\s*>\s$/, // blockquote
  /^\s*[-+*]\s$/, // bullet list
  /^\d+\.\s$/, // ordered list
  /^(?:```|~~~)[a-z]*[\s\n]$/, // code block
  /^(?:---|—-|___\s|\*\*\*\s)$/, // horizontal rule
]

/** Opens blocks after line break without needing a hard break. */
export const BlockOpeners = Extension.create({
  name: 'blockOpeners',
  // Above LineBreaks
  priority: 160,

  addKeyboardShortcuts() {
    return {
      'Shift-Enter': () => openLineBlock(this.editor),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockOpeners'),
        props: { handleTextInput: openBlock },
      }),
    ]
  },
})

/** Opens the block and reports whether it opened. */
export function openLineBlock(editor: Editor): boolean {
  const { state, view } = editor
  if (!opensBlock(state, '\n')) return false

  const tr = promoteLine(state)
  if (tr) view.dispatch(tr)

  return offerToRules(view, ' ')
}

/** Whether typing `typed` at the caret completes a block opener. */
export function opensBlock(state: EditorState, typed: string): boolean {
  const { $from, empty } = state.selection
  if (!empty || !inTopLevelParagraph($from) || inCodeMark($from)) return false

  const line = caretLine(state)
  if (!line) return false

  const text = line.before + typed
  return BLOCK_OPENERS.some((opener) => opener.test(text))
}

/**
 * Turns the breaks around the caret's line into paragraph splits, leaving the
 * line as a text block of its own with the caret still on it.
 * Returns null when the line is already the whole block.
 */
function promoteLine(state: EditorState): Transaction | null {
  const line = caretLine(state)
  if (!line || (!line.breakBefore && !line.breakAfter)) return null

  const tr = state.tr
  // Below first, so that the split above leaves its positions alone
  if (line.breakAfter) splitAtBreaks(tr, line.breakAfter)
  if (line.breakBefore) splitAtBreaks(tr, line.breakBefore)

  // A split leaves two positions where the breaks it replaces were
  const { breakBefore } = line
  const shift = breakBefore ? 2 - (breakBefore.to - breakBefore.from) : 0
  tr.setSelection(TextSelection.create(tr.doc, state.selection.from + shift))
  return tr
}

/** Replaces a run of breaks with a single paragraph split. */
function splitAtBreaks(tr: Transaction, breaks: PositionRange): void {
  tr.delete(breaks.from, breaks.to)
  tr.split(breaks.from)
}

/** Promotes the caret's line when the typed character completes an opener. */
function openBlock(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (from !== to || text.length !== 1) return false

  const { state } = view
  if (!opensBlock(state, text)) return false

  // Without a promotion the input rule matches the line on its own
  const tr = promoteLine(state)
  if (!tr) return false

  view.dispatch(tr)
  if (!offerToRules(view, text)) {
    view.dispatch(view.state.tr.insertText(text))
  }
  return true
}

/**
 * Offers `text` to the input rules at the caret, the way the browser offers a
 * character it is about to type, and reports whether it was handled.
 */
function offerToRules(view: EditorView, text: string): boolean {
  const caret = view.state.selection.from
  const insert = () => view.state.tr.insertText(text, caret)
  const handled = view.someProp('handleTextInput', (handler) =>
    handler(view, caret, caret, text, insert),
  )
  return handled === true
}

/** Whether the caret sits in code, where input rules never fire. */
function inCodeMark($pos: ResolvedPos): boolean {
  const marks = $pos.marks()
  return marks.some((mark) => mark.type.spec.code)
}
