import {
  SOURCE_DELIMITERS,
  type SourceFormat,
  type SourceSpan,
  collectSourceSpans,
  sourceDelimiterRanges,
} from '@/lib/tiptap/inline-source'
import { blockLines } from '@/lib/tiptap/lines'
import { codeDelimiters } from '@/lib/tiptap/source-normalize'
import type { Command } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { Selection, Transaction } from '@tiptap/pm/state'

/** Removes delimiter pairs without removing any of their contents. */
export function removeSourceDelimiters(
  tr: Transaction,
  spans: SourceSpan[],
): void {
  const ranges = sourceDelimiterRanges(spans).sort((a, b) => b.from - a.from)
  for (const range of ranges) tr.delete(range.from, range.to)
}

type SourceMode = 'toggle' | 'set' | 'unset'

/** Applies a native formatting command to editable source. */
export function sourceFormatCommand(
  format: SourceFormat,
  mode: SourceMode = 'toggle',
): Command {
  return ({ editor, tr, dispatch }) => {
    if (!editor.markdown) return false

    const selection = TextSelection.between(
      tr.selection.$anchor,
      tr.selection.$head,
    )
    if (!(selection instanceof TextSelection)) return false

    const entirelyInCodeBlock =
      selection.$from.sameParent(selection.$to) &&
      selection.$from.parent.type.spec.code
    if (entirelyInCodeBlock) return false

    const spans = collectSourceSpans(tr.doc, editor.markdown)
    const { current, affected } = selectedFormats(spans, format, selection)
    if (current && mode === 'set') return true

    const remove = current ? [current] : mode === 'unset' ? affected : null
    const insideCode = spans.some(
      (span) =>
        span.format === 'code' &&
        selection.from >= span.contentFrom &&
        selection.to <= span.contentTo,
    )
    if (!remove && insideCode) return false
    if (!dispatch) return true

    tr.setSelection(selection)
    if (remove) removeSourceDelimiters(tr, remove)
    else applySourceFormat(tr, affected, format)

    return true
  }
}

function selectedFormats(
  spans: SourceSpan[],
  format: SourceFormat,
  selection: Selection,
) {
  const { from, to } = selection
  const matching = spans.filter((span) => span.format === format)

  const current = matching
    .filter((span) => from >= span.from && to <= span.to)
    .at(-1)

  const affected = matching.filter((span) =>
    selection.empty
      ? from >= span.from && from <= span.to
      : from < span.to && to > span.from,
  )

  return { current, affected }
}

function applySourceFormat(
  tr: Transaction,
  affected: SourceSpan[],
  format: SourceFormat,
): void {
  const { from, to, anchor, head } = tr.selection
  const start = Math.min(from, ...affected.map((span) => span.from))
  const end = Math.max(to, ...affected.map((span) => span.to))
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      anchor > head ? end : start,
      anchor > head ? start : end,
    ),
  )
  removeSourceDelimiters(tr, affected)
  wrapSelection(tr, format)
}

function wrapSelection(tr: Transaction, format: SourceFormat): void {
  const { from, to, anchor, head } = tr.selection
  const ranges = selectionRanges(tr, format)
  const mapStart = tr.mapping.maps.length

  for (const range of ranges.reverse()) {
    insertPair(tr, range, format)
  }

  const map = tr.mapping.slice(mapStart)
  const start = map.map(from, 1)
  const end = from === to ? start - SOURCE_DELIMITERS[format].length : map.map(to, -1) // prettier-ignore
  const selectionStart = Math.min(start, end)

  tr.setSelection(
    TextSelection.create(
      tr.doc,
      anchor > head ? end : selectionStart,
      anchor > head ? selectionStart : end,
    ),
  )
  tr.setStoredMarks(null)
}

function selectionRanges(tr: Transaction, format: SourceFormat): WrapRange[] {
  const { from, to } = tr.selection
  const ranges: WrapRange[] = []

  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return

    for (const line of blockLines(node, pos + 1)) {
      const start = Math.max(from, line.start)
      const end = Math.min(to, line.start + line.text.length)
      if (end < start) continue

      const text = tr.doc.textBetween(start, end, '', '\n')
      if (!text && from !== to) continue

      const range = { from: start, to: end, text }

      if (format !== 'code' && text.trim()) {
        range.from += text.length - text.trimStart().length
        range.to -= text.length - text.trimEnd().length
        range.text = text.trim()
      }
      ranges.push(range)
    }

    return false
  })

  return ranges
}

type WrapRange = { from: number; to: number; text: string }

function insertPair(
  tr: Transaction,
  range: WrapRange,
  format: SourceFormat,
): void {
  const delimiter = SOURCE_DELIMITERS[format]
  const { open, close } =
    format === 'code'
      ? codeDelimiters(range.text)
      : { open: delimiter, close: delimiter }

  tr.insert(range.to, tr.doc.type.schema.text(close))
  tr.insert(range.from, tr.doc.type.schema.text(open))
}

/** Clears editable inline formatting and the remaining native marks. */
export const clearSourceFormatting: Command = ({ editor, tr, dispatch }) => {
  if (!editor.markdown) return false

  const selection = TextSelection.between(
    tr.selection.$anchor,
    tr.selection.$head,
  )
  if (!(selection instanceof TextSelection)) return false

  const { from, to } = selection
  const spans = collectSourceSpans(tr.doc, editor.markdown).filter(
    (span) => from <= span.to && to >= span.from,
  )

  if (dispatch) {
    tr.setSelection(selection)
    tr.removeMark(from, to)
    removeSourceDelimiters(tr, spans)
    tr.setStoredMarks([])
  }

  return true
}
