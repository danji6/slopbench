import type { Node, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

/** A single line within a text block, as its hard breaks delimit it. */
export type BlockLine = {
  /** Document position the line starts at. */
  start: number
  text: string
}

/** A document range as a pair of positions. */
export type PositionRange = { from: number; to: number }

/** The line the caret sits on, split at the caret. */
export type CaretLine = BlockLine & {
  before: string
  after: string
  /**
   * The breaks that separate the line from the one above, blank lines
   * included, or null when the line opens its block.
   */
  breakBefore: PositionRange | null
  /** The same below the line, or null when the line closes its block. */
  breakAfter: PositionRange | null
}

/**
 * Splits a text block into its lines, i.e. on a hard break or on a newline
 * within the text itself.
 */
export function blockLines(parent: Node, parentStart: number): BlockLine[] {
  const lines: BlockLine[] = []
  let start = parentStart
  let text = ''

  // Ends the current line on the break occupying `breakPos`
  function breakLine(breakPos: number): void {
    lines.push({ start, text })
    text = ''
    start = breakPos + 1
  }

  parent.forEach((child, offset) => {
    const childStart = parentStart + offset
    if (child.type.name === 'hardBreak') {
      breakLine(childStart)
    } else if (child.isText && child.text) {
      let at = childStart
      child.text.split('\n').forEach((part, index) => {
        if (index > 0) breakLine(at - 1)
        text += part
        at += part.length + 1
      })
    } else {
      text += ' '
    }
  })

  lines.push({ start, text })
  return lines
}

/** The line the caret sits on, if it sits in a text block at all. */
export function caretLine(state: EditorState): CaretLine | null {
  const { from } = state.selection
  const $from = state.doc.resolve(from)
  if (!$from.parent.isTextblock) return null

  const lines = blockLines($from.parent, $from.start())
  const index = lines.findIndex(
    (line) => from >= line.start && from <= line.start + line.text.length,
  )
  if (index === -1) return null

  const line = lines[index]
  const column = from - line.start
  return {
    ...line,
    before: line.text.slice(0, column),
    after: line.text.slice(column),
    breakBefore: breakRunBefore(lines, index),
    breakAfter: breakRunAfter(lines, index),
  }
}

/** The run of breaks above `index`, blank lines making it longer than one. */
function breakRunBefore(
  lines: BlockLine[],
  index: number,
): PositionRange | null {
  if (index === 0) return null
  let above = index - 1
  while (above > 0 && lines[above].text === '') above -= 1
  return {
    from: lines[above].start + lines[above].text.length,
    to: lines[index].start,
  }
}

/** The run of breaks below `index`. */
function breakRunAfter(
  lines: BlockLine[],
  index: number,
): PositionRange | null {
  const last = lines.length - 1
  if (index === last) return null
  let below = index + 1
  while (below < last && lines[below].text === '') below += 1
  return {
    from: lines[index].start + lines[index].text.length,
    to: lines[below].start,
  }
}

/** Whether the position sits in a paragraph the document holds directly. */
export function inTopLevelParagraph($pos: ResolvedPos): boolean {
  return $pos.depth === 1 && $pos.parent.type.name === 'paragraph'
}
