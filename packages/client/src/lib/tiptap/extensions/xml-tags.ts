import { INDENT_UNIT } from '@/lib/tiptap/code-pairs'
import { isEmptyXmlTagPair, xmlTagToClose } from '@sb/core/xml-tags'
import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Fragment } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const xmlTagsKey = new PluginKey('xmlTags')

/** Completes literal XML tags and indents empty pairs in every editor context. */
export const XmlTags = Extension.create({
  name: 'xmlTags',
  // Run before the interpreter (201) and code block (200) input handlers
  priority: 210,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: xmlTagsKey,
        appendTransaction: (transactions, _previous, state) => {
          const expanded = transactions.some((tr) => tr.getMeta(xmlTagsKey))
          // Keep subsequent body typing in its own undo group
          return expanded ? closeHistory(state.tr) : null
        },
        props: {
          handleTextInput: closeTag,
          handleKeyDown: (view, event) => {
            if (event.key !== 'Enter' || event.isComposing) return false
            if (event.ctrlKey || event.metaKey || event.altKey) return false
            if (!expandTagPair(view)) return false
            event.preventDefault()
            return true
          },
        },
      }),
    ]
  },
})

function canExpand(view: EditorView): boolean {
  if (!view.editable || view.composing) return false
  const { selection } = view.state
  return selection instanceof TextSelection && selection.empty
}

/** Reads source text with one character per inline node to preserve positions. */
function caretText(view: EditorView) {
  const { $from } = view.state.selection
  const parent = $from.parent
  return {
    before: parent.textBetween(0, $from.parentOffset, '\n', '\ufffc'),
    after: parent.textBetween(
      $from.parentOffset,
      parent.content.size,
      '\n',
      '\ufffc',
    ),
  }
}

function closeTag(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text !== '>') return false
  if (from !== to || !canExpand(view)) return false
  const { before, after } = caretText(view)
  const name = xmlTagToClose(before + text, after)
  if (!name) return false

  const tr = view.state.tr.insertText(`></${name}>`, from, to)
  tr.setSelection(TextSelection.create(tr.doc, from + 1))
  dispatchExpansion(view, tr)
  return true
}

function expandTagPair(view: EditorView): boolean {
  if (!canExpand(view)) return false
  const { before, after } = caretText(view)
  if (!isEmptyXmlTagPair(before, after)) return false

  const line = before.slice(before.lastIndexOf('\n') + 1)
  const indent = line.match(/^[ \t]*/)![0]
  const inner = indent + INDENT_UNIT
  const { state } = view
  const { from, $from } = state.selection
  const tr = state.tr

  if ($from.parent.type.spec.code) {
    tr.insertText(`\n${inner}\n${indent}`, from)
  } else {
    const scaffold = indentedBody(state, indent)
    if (!scaffold) return false
    tr.insert(from, scaffold)
  }
  tr.setSelection(TextSelection.create(tr.doc, from + 1 + inner.length))
  dispatchExpansion(view, tr)
  return true
}

/** Keeps each expansion separate from preceding and following typing. */
function dispatchExpansion(view: EditorView, tr: Transaction): void {
  view.dispatch(closeHistory(tr).setMeta(xmlTagsKey, true).scrollIntoView())
}

/** Builds body and closing lines without splitting the surrounding text block. */
function indentedBody(state: EditorState, indent: string): Fragment | null {
  const { $from } = state.selection
  const hardBreak = state.schema.nodes.hardBreak
  if (!hardBreak) return null
  const acceptsBreak = $from.parent.canReplaceWith(
    $from.index(),
    $from.index(),
    hardBreak,
  )
  if (!acceptsBreak) return null

  const marks = state.storedMarks ?? $from.marks()
  const nodes = [
    hardBreak.create(),
    state.schema.text(indent + INDENT_UNIT, marks),
    hardBreak.create(),
  ]
  if (indent) nodes.push(state.schema.text(indent, marks))
  return Fragment.fromArray(nodes)
}
