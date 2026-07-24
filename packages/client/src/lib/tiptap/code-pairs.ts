import { leafText } from '@/lib/tiptap/serialize'
import { type EditorState, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export const INDENT_UNIT = '  '

/** Brackets and quotes that are auto-closed around the caret. */
const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
}
const CLOSERS = new Set(Object.values(PAIRS))
/** Closing brackets that dedent their line when typed on a blank line. */
const DEDENT_CLOSERS = new Set(['}', ')', ']'])

/** Whether the caret at `pos` sits in an editable code region. */
export type CodeGate = (state: EditorState, pos: number) => boolean

/**
 * Auto-closes brackets/quotes, skips over existing ones, and dedents a closing
 * bracket typed alone on an indented line.
 */
export function autoClosePairs(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  inCode: CodeGate,
): boolean {
  if (text.length !== 1) return false
  const { state } = view
  if (!inCode(state, from)) return false

  const $from = state.doc.resolve(from)
  const blockBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    '\n',
    leafText,
  )
  const line = blockBefore.slice(blockBefore.lastIndexOf('\n') + 1)
  const prevChar = blockBefore.slice(-1)
  const $to = state.doc.resolve(to)
  const after = $to.parent.textBetween(
    $to.parentOffset,
    $to.parent.content.size,
    '\n',
    leafText,
  )
  const nextChar = after.slice(0, 1)

  // Skip over an auto-inserted closer instead of typing a duplicate
  if (from === to && CLOSERS.has(text) && nextChar === text) {
    view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, to + 1))
        .scrollIntoView(),
    )
    return true
  }

  // Dedent a closing bracket typed as the first thing on its line
  if (
    from === to &&
    DEDENT_CLOSERS.has(text) &&
    /^[ \t]*$/.test(line) &&
    line.endsWith(INDENT_UNIT)
  ) {
    const lineStart = from - line.length
    const tr = state.tr.delete(lineStart, lineStart + INDENT_UNIT.length)
    tr.insertText(text, from - INDENT_UNIT.length)
    view.dispatch(tr.scrollIntoView())
    return true
  }

  const close = PAIRS[text]
  if (!close) return false

  const wrap = from !== to
  if (!wrap) {
    // Don't auto-close against adjacent text
    if (nextChar && !/[\s)\]}'"]/.test(nextChar)) return false
    // Quotes are ambiguous next to words
    if (close === text && /\w/.test(prevChar)) return false
  }

  const selected = state.doc.textBetween(from, to, '\n', leafText)
  const tr = state.tr.insertText(text + selected + close, from, to)
  tr.setSelection(
    TextSelection.create(tr.doc, from + 1, from + 1 + selected.length),
  )
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Removes both sides when backspacing inside an empty auto-closed pair. */
export function deletePair(
  view: EditorView,
  event: KeyboardEvent,
  inCode: CodeGate,
): boolean {
  if (event.key !== 'Backspace') return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false

  const { state } = view
  const { from, empty } = state.selection
  if (!empty || !inCode(state, from)) return false

  const $from = state.doc.resolve(from)
  const offset = $from.parentOffset
  if (offset === 0 || offset === $from.parent.content.size) return false
  const prev = $from.parent.textBetween(offset - 1, offset)
  const next = $from.parent.textBetween(offset, offset + 1)
  if (PAIRS[prev] !== next) return false

  view.dispatch(state.tr.delete(from - 1, from + 1).scrollIntoView())
  return true
}

/** Removes an indent unit when backspacing leading whitespace. */
export function backspaceIndent(
  view: EditorView,
  event: KeyboardEvent,
  inCode: CodeGate,
): boolean {
  if (event.key !== 'Backspace') return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false

  const { state } = view
  const { from, empty } = state.selection
  if (!empty || !inCode(state, from)) return false

  const $from = state.doc.resolve(from)
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', leafText)
  const line = before.slice(before.lastIndexOf('\n') + 1)
  // Only when everything before the caret on this line is spaces
  if (!/^ +$/.test(line)) return false

  const unit = INDENT_UNIT.length
  const remove = ((line.length - 1) % unit) + 1
  view.dispatch(state.tr.delete(from - remove, from).scrollIntoView())
  return true
}
