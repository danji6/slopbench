import {
  type CodeGate,
  INDENT_UNIT,
  autoClosePairs,
  backspaceIndent,
  deletePair,
} from '@/lib/tiptap/code-pairs'
import { opensBlock } from '@/lib/tiptap/extensions/block-openers'
import { applyIndentRules } from '@/lib/tiptap/extensions/code-edit'
import { collectDocText, offsetAt } from '@/lib/tiptap/interpreter-doc'
import { isInCodeContext } from '@/lib/tiptap/interpreter-syntax'
import { blockLines, caretLine } from '@/lib/tiptap/lines'
import { Extension } from '@tiptap/core'
import { Fragment, type Node } from '@tiptap/pm/model'
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

/** A bare `#if`/`#elif` opener line (its multiline condition follows below). */
const RE_BARE_IF = /^[ \t]*#(?:if|elif)[ \t]*$/

/** An inline `#if <expr>` opener, which needs an `#endif`. */
const RE_INLINE_IF = /^[ \t]*#if[ \t]+\S/

/** Caret is inside an interpreter JS region (shared pair/indent gate). */
const inCode: CodeGate = (state, pos) => inInterpreterCode(state, pos)

/**
 * Interpreter input:
 * - Typing `#eval` adds an `#end` closer.
 * - Pressing Enter right after `#if`/`#elif` adds a `#then` closer.
 * - Inside an interpreter code region (`#eval`/`#if` body), Tab and Shift+Tab
 *   indent, Enter preserves indentation, and brackets/quotes auto-close.
 */
export const InterpreterInput = Extension.create({
  name: 'interpreterInput',
  // Must be higher than CodeEdit
  priority: 201,
  addKeyboardShortcuts() {
    return {
      Tab: () => indentCodeRegion(this.editor, false),
      'Shift-Tab': () => indentCodeRegion(this.editor, true),
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('interpreterInput'),
        props: {
          handleKeyDown: (view, event) =>
            handleEnter(editor, event) ||
            deletePair(view, event, inCode) ||
            backspaceIndent(view, event, inCode),
          handleTextInput: (view, from, to, text) =>
            scaffoldEvalBlock(view, from, to, text) ||
            keepOpenerLiteral(view, from, to, text) ||
            autoClosePairs(view, from, to, text, inCode),
        },
      }),
    ]
  },
})

/** Whether the caret at `pos` sits in an interpreter JS region. */
function inInterpreterCode(
  state: EditorState,
  pos = state.selection.from,
): boolean {
  const parent = state.doc.resolve(pos).parent
  if (!parent.isTextblock || parent.type.name === 'codeBlock') return false
  const map = collectDocText(state.doc)
  return isInCodeContext(map.text, offsetAt(map, pos))
}

/** Count of leading spaces on `text`, capped at `max`. */
function leadingSpaces(text: string, max: number): number {
  let n = 0
  while (n < max && text[n] === ' ') n++
  return n
}

/** Indents or outdents the selected lines of an interpreter code region. */
function indentCodeRegion(editor: Editor, outdent: boolean): boolean {
  const { state } = editor
  if (!inInterpreterCode(state)) return false

  const { from, to, empty } = state.selection
  const $from = state.doc.resolve(from)
  // Let the fallback handle selections spanning multiple text blocks
  if (!empty && !$from.sameParent(state.doc.resolve(to))) return false

  if (empty && !outdent) {
    editor.view.dispatch(state.tr.insertText(INDENT_UNIT, from))
    return true
  }

  const lines = blockLines($from.parent, $from.start())
  const tr = state.tr
  let shift = 0

  for (const line of lines) {
    if (line.start + line.text.length < from || line.start > to) continue
    if (outdent) {
      const remove = leadingSpaces(line.text, INDENT_UNIT.length)
      if (remove > 0) {
        tr.delete(line.start + shift, line.start + shift + remove)
        shift -= remove
      }
    } else {
      tr.insertText(INDENT_UNIT, line.start + shift)
      shift += INDENT_UNIT.length
    }
  }

  if (tr.docChanged) editor.view.dispatch(tr)
  return true
}

/** Routes a plain Enter to `#then` scaffolding or an indented newline. */
function handleEnter(editor: Editor, event: KeyboardEvent): boolean {
  if (event.key !== 'Enter') return false
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  const handled =
    scaffoldThenBlock(editor) ||
    scaffoldEndifBlock(editor) ||
    newlineKeepIndent(editor)
  if (handled) {
    event.preventDefault()
    event.stopPropagation()
  }
  return handled
}

/** Preserves indentation when pressing Enter inside an interpreter code region. */
function newlineKeepIndent(editor: Editor): boolean {
  const { state } = editor
  if (!inInterpreterCode(state) || !state.selection.empty) return false

  const { from } = state.selection
  const line = caretLine(state)
  if (!line) return false

  const { before, after } = line
  const indent = before.match(/^[ \t]*/)![0]
  const result = applyIndentRules({ before, after, indent })

  const hardBreak = state.schema.nodes.hardBreak
  if (!hardBreak) return false

  const nodes: Node[] = [hardBreak.create()]
  if (result.indent) nodes.push(state.schema.text(result.indent))
  if (result.closeIndent !== undefined) {
    nodes.push(hardBreak.create())
    if (result.closeIndent) nodes.push(state.schema.text(result.closeIndent))
  }

  const tr = state.tr.insert(from, Fragment.fromArray(nodes))
  tr.setSelection(TextSelection.create(tr.doc, from + 1 + result.indent.length))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

/** A `[body line]` + `closer` scaffold, e.g. `#then`. */
function closerScaffold(state: EditorState, closer: string): Fragment | null {
  const hardBreak = state.schema.nodes.hardBreak
  if (!hardBreak) return null
  return Fragment.fromArray([
    hardBreak.create(),
    hardBreak.create(),
    state.schema.text(closer),
  ])
}

/**
 * When Enter is pressed at the end of an opener line matching `openerRe`,
 * scaffolds its `closer` two lines below (mirroring the `#eval`/`#end` scaffold)
 * and drops the caret on the empty body line between them.
 */
function scaffoldCloserAtLine(
  editor: Editor,
  openerRe: RegExp,
  closer: string,
): boolean {
  const { state } = editor
  const { from, empty } = state.selection
  if (!empty) return false

  const $from = state.doc.resolve(from)
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.name === 'codeBlock') return false

  const before = parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const line = before.slice(before.lastIndexOf('\n') + 1)
  if (!openerRe.test(line)) return false

  const after = parent.textBetween(
    $from.parentOffset,
    parent.content.size,
    '\n',
    '\n',
  )
  const nextBreak = after.indexOf('\n')
  const restOfLine = nextBreak === -1 ? after : after.slice(0, nextBreak)
  if (restOfLine.trim() !== '') return false

  const scaffold = closerScaffold(state, closer)
  if (!scaffold) return false

  const tr = state.tr.insert(from, scaffold)
  tr.setSelection(TextSelection.create(tr.doc, from + 1))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

/** Enter right after `#if`/`#elif` scaffolds its `#then`. */
function scaffoldThenBlock(editor: Editor): boolean {
  return scaffoldCloserAtLine(editor, RE_BARE_IF, '#then')
}

/** Enter on an inline `#if <expr>` scaffolds its `#endif`. */
function scaffoldEndifBlock(editor: Editor): boolean {
  return scaffoldCloserAtLine(editor, RE_INLINE_IF, '#endif')
}

/** Types a markdown block opener as plain text inside a code region. */
function keepOpenerLiteral(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const { state } = view
  if (!inInterpreterCode(state) || !opensBlock(state, text)) return false
  view.dispatch(state.tr.insertText(text, from, to))
  return true
}

/** Turns a completed `#eval` line into an `#eval`/body/`#end` block. */
function scaffoldEvalBlock(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (from !== to || text.length !== 1) return false

  const { state } = view
  const $from = state.doc.resolve(from)
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.name === 'codeBlock') return false

  const before = parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const line = before.slice(before.lastIndexOf('\n') + 1)
  if (line + text !== '#eval') return false

  const after = parent.textBetween(
    $from.parentOffset,
    parent.content.size,
    '\n',
    '\n',
  )
  const nextBreak = after.indexOf('\n')
  const restOfLine = nextBreak === -1 ? after : after.slice(0, nextBreak)
  if (restOfLine.trim() !== '') return false

  const scaffold = closerScaffold(state, '#end')
  if (!scaffold) return false

  const insertAt = from + text.length
  const tr = state.tr.insertText(text, from, to).insert(insertAt, scaffold)
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
  view.dispatch(tr.scrollIntoView())
  return true
}
