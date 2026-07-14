import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

const INDENT_UNIT = '  '

/** Basic code editing functionality with indent support and common shortcuts. */
export const CodeEdit = Extension.create({
  name: 'codeEdit',
  // Let Ctrl/Cmd-Enter win over codeBlock's exitCode binding
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Tab: () => adjustIndent(this.editor, false),
      'Shift-Tab': () => adjustIndent(this.editor, true),
      Enter: () => newlineKeepIndent(this.editor),
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('codeEdit'),
        props: {
          handleKeyDown: (view, event) =>
            insertLineBelow(view, event) ||
            deleteWordBackward(view, event) ||
            deletePair(view, event) ||
            backspaceIndent(view, event),
          handleTextInput: (view, from, to, text) => {
            if (shouldBreakHistory(view, from, text))
              view.dispatch(closeHistory(view.state.tr))
            return autoClosePairs(view, from, to, text)
          },
        },
      }),
    ]
  },
})

const WORD = /[\w$]/

/** Undo condition with word/token boundary awareness. */
function shouldBreakHistory(
  view: EditorView,
  from: number,
  text: string,
): boolean {
  if (text.length !== 1) return false

  const $from = view.state.doc.resolve(from)
  if ($from.parent.type.name !== 'codeBlock' || $from.parentOffset === 0) {
    return false
  }

  const prev = $from.parent.textBetween(
    $from.parentOffset - 1,
    $from.parentOffset,
  )

  return WORD.test(prev) && !WORD.test(text)
}

/** Ctrl/Cmd-Enter inserts a line below without splitting the current line. */
function insertLineBelow(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Enter') return false
  if ((!event.ctrlKey && !event.metaKey) || event.shiftKey || event.altKey)
    return false

  const { state } = view
  const { to } = state.selection
  const $to = state.doc.resolve(to)
  if ($to.parent.type.name !== 'codeBlock') return false

  event.preventDefault()
  event.stopPropagation()

  const text = $to.parent.textContent
  const lineStart = text.slice(0, $to.parentOffset).lastIndexOf('\n') + 1
  const nextLineBreak = text.indexOf('\n', $to.parentOffset)
  const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak
  const line = text.slice(lineStart, lineEnd)
  const indent = line.match(/^[ \t]*/)![0]

  const { indent: nextIndent } = applyIndentRules({
    before: line,
    after: '',
    indent,
  })

  const insertAt = $to.start() + lineEnd
  const insert = '\n' + nextIndent
  const tr = closeHistory(state.tr.insertText(insert, insertAt))

  tr.setSelection(TextSelection.create(tr.doc, insertAt + insert.length))
  view.dispatch(tr.scrollIntoView())
  return true
}

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

function autoClosePairs(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text.length !== 1) return false
  const { state } = view
  const $from = state.doc.resolve(from)
  if ($from.parent.type.name !== 'codeBlock') return false

  const blockBefore = $from.parent.textBetween(0, $from.parentOffset, '\n')
  const line = blockBefore.slice(blockBefore.lastIndexOf('\n') + 1)
  const prevChar = blockBefore.slice(-1)
  const $to = state.doc.resolve(to)
  const after = $to.parent.textBetween(
    $to.parentOffset,
    $to.parent.content.size,
    '\n',
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

  const selected = state.doc.textBetween(from, to, '\n')
  const tr = state.tr.insertText(text + selected + close, from, to)
  tr.setSelection(
    TextSelection.create(tr.doc, from + 1, from + 1 + selected.length),
  )
  view.dispatch(tr.scrollIntoView())
  return true
}

/** A modifier-augmented Backspace (delete word/line), handled specially. */
function isWordDelete(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey
}

const SPACE = /[ \t]/

/**
 * Ctrl/Alt-Backspace deletion. We implement it ourselves because the
 * line-number gutter widget at the block start corrupts the browser's
 * native word deletion on the first line.
 */
function deleteWordBackward(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Backspace' || !(event.ctrlKey || event.altKey)) {
    return false
  }

  const { state } = view
  const { from, empty } = state.selection
  if (!empty) return false

  const $from = state.doc.resolve(from)
  if ($from.parent.type.name !== 'codeBlock' || $from.parentOffset === 0) {
    return false
  }

  const offset = $from.parentOffset
  const before = $from.parent.textBetween(0, offset)
  const cut = wordStart(before)
  // Caret already at line start: let the default Backspace join the lines
  if (cut >= offset) return false

  view.dispatch(state.tr.delete(from - (offset - cut), from).scrollIntoView())
  return true
}

/** Index where a word-backward deletion stops, confined to the current line. */
function wordStart(text: string): number {
  const lineStart = text.lastIndexOf('\n') + 1
  let i = text.length
  while (i > lineStart && SPACE.test(text[i - 1])) i--
  if (i === lineStart) return lineStart

  const word = WORD.test(text[i - 1])
  while (
    i > lineStart &&
    !SPACE.test(text[i - 1]) &&
    WORD.test(text[i - 1]) === word
  ) {
    i--
  }
  return i
}

/** Backspace inside an empty auto-closed pair (`(|)`) removes both sides. */
function deletePair(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Backspace' || isWordDelete(event)) return false
  const { state } = view
  const { from, empty } = state.selection
  if (!empty) return false
  const $from = state.doc.resolve(from)
  if ($from.parent.type.name !== 'codeBlock') return false

  const offset = $from.parentOffset
  if (offset === 0 || offset === $from.parent.content.size) return false
  const prev = $from.parent.textBetween(offset - 1, offset)
  const next = $from.parent.textBetween(offset, offset + 1)
  if (PAIRS[prev] !== next) return false

  view.dispatch(state.tr.delete(from - 1, from + 1).scrollIntoView())
  return true
}

/** Backspace in leading whitespace removes a full indent unit (snaps to stop). */
function backspaceIndent(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Backspace' || isWordDelete(event)) return false
  const { state } = view
  const { from, empty } = state.selection
  if (!empty) return false
  const $from = state.doc.resolve(from)
  if ($from.parent.type.name !== 'codeBlock') return false

  const before = $from.parent.textBetween(0, $from.parentOffset, '\n')
  const line = before.slice(before.lastIndexOf('\n') + 1)
  // Only when everything before the caret on this line is spaces
  if (!/^ +$/.test(line)) return false

  const unit = INDENT_UNIT.length
  const remove = ((line.length - 1) % unit) + 1
  view.dispatch(state.tr.delete(from - remove, from).scrollIntoView())
  return true
}

/** What an indent rule sees about the line the caret sits on. */
type IndentContext = {
  /** The current line, up to the caret. */
  before: string
  /** The current line, from the caret onwards. */
  after: string
  /** Leading whitespace of the current line. */
  indent: string
}

/** How a newline should be indented. */
type IndentResult = {
  /** Indentation for the line the caret lands on. */
  indent: string
  /** If set, the text after the caret moves to its own line at this indent. */
  closeIndent?: string
}

type IndentRule = (ctx: IndentContext) => IndentResult | null

const CLOSING: Record<string, string> = { '{': '}', '(': ')', '[': ']' }

/** Adds a level of indent after an opening bracket. */
const bracketRule: IndentRule = ({ before, after, indent }) => {
  const close = CLOSING[before.trimEnd().slice(-1)]
  if (!close) return null
  const inner = indent + INDENT_UNIT
  if (after.trimStart().startsWith(close))
    return { indent: inner, closeIndent: indent }
  return { indent: inner }
}

/** Ordered indent rules. */
const INDENT_RULES: IndentRule[] = [bracketRule]

/** Runs the indent rules in order. First match wins. */
function applyIndentRules(ctx: IndentContext): IndentResult {
  for (const rule of INDENT_RULES) {
    const applied = rule(ctx)
    if (applied) return applied
  }
  return { indent: ctx.indent }
}

/** Inserts a newline, preserving indentation and applying any indent rules. */
function newlineKeepIndent(editor: Editor): boolean {
  const { state } = editor
  const { from, empty } = state.selection
  const $from = state.doc.resolve(from)
  if (!empty || $from.parent.type.name !== 'codeBlock') return false

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n')
  const before = textBefore.slice(textBefore.lastIndexOf('\n') + 1)
  const indent = before.match(/^[ \t]*/)![0]
  const rest = $from.parent.textBetween(
    $from.parentOffset,
    $from.parent.content.size,
    '\n',
  )
  const nl = rest.indexOf('\n')
  const after = nl === -1 ? rest : rest.slice(0, nl)

  const result = applyIndentRules({ before, after, indent })

  const tr = closeHistory(state.tr)
  if (result.closeIndent === undefined) {
    tr.insertText('\n' + result.indent)
  } else {
    tr.insertText('\n' + result.indent + '\n' + result.closeIndent)
    tr.setSelection(
      TextSelection.create(tr.doc, from + 1 + result.indent.length),
    )
  }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

function adjustIndent(editor: Editor, outdent: boolean): boolean {
  const { state } = editor
  const { doc, selection } = state
  const { from, to, empty } = selection
  const $from = doc.resolve(from)
  if ($from.parent.type.name !== 'codeBlock') return false

  // A caret indent simply inserts the indent unit at the cursor
  if (empty && !outdent) {
    editor.view.dispatch(state.tr.insertText(INDENT_UNIT, from))
    return true
  }

  const blockStart = $from.start()
  const tr = state.tr
  let shift = 0

  for (const line of lineRanges($from.parent.textContent)) {
    const lineFrom = blockStart + line.start
    if (lineFrom > to || blockStart + line.end < from) continue
    if (outdent) {
      const count = leadingSpaces(line.text, INDENT_UNIT.length)
      if (count > 0) {
        tr.delete(lineFrom + shift, lineFrom + shift + count)
        shift -= count
      }
    } else {
      tr.insertText(INDENT_UNIT, lineFrom + shift)
      shift += INDENT_UNIT.length
    }
  }

  if (tr.docChanged) editor.view.dispatch(tr)
  return true
}

type LineRange = { start: number; end: number; text: string }

function lineRanges(text: string): LineRange[] {
  const ranges: LineRange[] = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      ranges.push({ start, end: i, text: text.slice(start, i) })
      start = i + 1
    }
  }
  return ranges
}

function leadingSpaces(text: string, max: number): number {
  let n = 0
  while (n < max && text[n] === ' ') n++
  return n
}
