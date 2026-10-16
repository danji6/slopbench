import {
  type SnippetStop,
  activateSnippet,
} from '@/lib/tiptap/extensions/snippet-stops'
import type { CompletionItem } from '@sb/core/code-completion/types'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

import type { CompletionDocument } from './document'

type ParsedStop = { start: number; end: number }

/** Inserts a literal or snippet using source offsets from its document snapshot. */
export function applyCompletion(
  editor: Editor,
  map: CompletionDocument,
  item: CompletionItem,
): boolean {
  const from = map.toDocument(item.from, 'start')
  const to = item.from === item.to ? from : map.toDocument(item.to, 'end')
  if (from === null || to === null) return false

  const { text, stops } =
    item.snippet === undefined
      ? { text: item.insertText ?? item.label, stops: [] }
      : parseSnippet(item.snippet)
  const caret = Math.max(
    0,
    Math.min(text.length, item.caretOffset ?? text.length),
  )
  const first = stops[0] ?? { start: caret, end: caret }

  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.insertText(text, from, to)
      tr.setSelection(
        TextSelection.create(tr.doc, from + first.start, from + first.end),
      )
      return true
    })
    .run()

  const absolute: SnippetStop[] = stops.map((stop) => ({
    from: from + stop.start,
    to: from + stop.end,
  }))

  // Literal completions must preserve the enclosing snippet's mapped stops
  if (stops.length > 0) activateSnippet(editor.view, absolute)
  return true
}

/** Expands numbered placeholders, ordering the final $0 stop last. */
export function parseSnippet(snippet: string): {
  text: string
  stops: ParsedStop[]
} {
  let text = ''
  let last = 0
  const numbered: { num: number; start: number; end: number }[] = []

  for (const match of snippet.matchAll(/\$(\d+)|\$\{(\d+):([^}]*)\}/g)) {
    text += snippet.slice(last, match.index)
    last = match.index + match[0].length
    const num = Number(match[1] ?? match[2])
    const label = match[3] ?? ''
    const start = text.length
    text += label
    numbered.push({ num, start, end: text.length })
  }

  text += snippet.slice(last)
  numbered.sort((a, b) => stopRank(a.num) - stopRank(b.num))

  return { text, stops: numbered.map(({ start, end }) => ({ start, end })) }
}

const stopRank = (num: number) => (num === 0 ? Infinity : num)
