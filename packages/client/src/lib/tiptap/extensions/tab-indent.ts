import { INDENT_UNIT } from '@/lib/tiptap/code-pairs'
import { type BlockLine, blockLines } from '@/lib/tiptap/lines'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

/**
 * Fallback Tab handling. (De-)indents instead of letting the browser move focus
 * out of the editor. Every other Tab handler outranks this one.
 */
export const TabIndent = Extension.create({
  name: 'tabIndent',
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => indentSelection(this.editor, false),
      'Shift-Tab': () => indentSelection(this.editor, true),
    }
  },
})

/** Always swallows the key; changes the doc only where there is something to do. */
function indentSelection(editor: Editor, outdent: boolean): boolean {
  const { state } = editor
  const { from, to, empty } = state.selection

  // A caret indent simply inserts the indent unit at the cursor
  if (empty && !outdent) {
    // Gap cursors are empty selections too, but have no line to indent
    if (!state.selection.$from.parent.isTextblock) return true
    editor.view.dispatch(
      state.tr.insertText(INDENT_UNIT, from).scrollIntoView(),
    )
    return true
  }

  const blocks = empty ? [caretBlock(state)] : selectedBlocks(state, from, to)
  const tr = state.tr
  // Blocks and lines are edited in document order, so one running offset
  // fixes every later line start against all earlier edits
  let shift = 0

  for (const block of blocks) {
    if (!block) continue

    const lines = empty
      ? [caretLine(block, from)].filter((line) => line !== null)
      : blockLines(block.node, block.start).filter((line) =>
          intersects(line, from, to),
        )

    for (const line of lines) {
      if (outdent) {
        const remove = leadingSpaces(line.text)
        if (remove === 0) continue
        const at = line.start + shift
        tr.delete(at, at + remove)
        shift -= remove
      } else {
        tr.insertText(INDENT_UNIT, line.start + shift)
        shift += INDENT_UNIT.length
      }
    }
  }

  if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView())
  return true
}

type TextBlock = { node: Node; start: number }

/** The text block holding the caret, or null when there is none. */
function caretBlock(state: EditorState): TextBlock | null {
  const $from = state.selection.$from
  if (!$from.parent.isTextblock) return null
  return { node: $from.parent, start: $from.start() }
}

/** Text blocks whose content intersects `[from, to]`, in document order. */
function selectedBlocks(
  state: EditorState,
  from: number,
  to: number,
): TextBlock[] {
  const blocks: TextBlock[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) blocks.push({ node, start: pos + 1 })
    return true
  })
  return blocks
}

/** The line the caret sits on; at a break it belongs to the line below. */
function caretLine(block: TextBlock, pos: number): BlockLine | null {
  let found: BlockLine | null = null
  for (const line of blockLines(block.node, block.start)) {
    if (line.start > pos) return found
    found = line
  }
  return found
}

/** Whether any part of the line lies within `[from, to]`. */
function intersects(line: BlockLine, from: number, to: number): boolean {
  return line.start + line.text.length >= from && line.start <= to
}

/** Count of leading spaces, capped at one indent unit. */
function leadingSpaces(text: string): number {
  let n = 0
  while (n < INDENT_UNIT.length && text[n] === ' ') n++
  return n
}
