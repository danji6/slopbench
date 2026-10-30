import { diffWordsWithSpace } from 'diff'

import type { DiffLineType } from './diff'

export type TextRange = { start: number; end: number }

const MAX_BLOCK_CHARS = 8_000
const MAX_DIFF_CHARS = 60_000

/** Find changed words within replacement blocks, preserving whitespace offsets. */
export function intralineRanges(text: string[], types: DiffLineType[]) {
  const ranges: TextRange[][] = text.map(() => [])
  let remaining = MAX_DIFF_CHARS
  let start = 0

  while (start < text.length) {
    if (types[start] !== 'remove' && types[start] !== 'add') {
      start++
      continue
    }
    let end = start + 1
    while (types[end] === 'remove' || types[end] === 'add') end++
    const removed = indicesOf(types, start, end, 'remove')
    const added = indicesOf(types, start, end, 'add')
    const before = removed.map((index) => text[index]).join('\n')
    const after = added.map((index) => text[index]).join('\n')
    const size = before.length + after.length
    const canCompare = removed.length > 0 && added.length > 0

    if (canCompare && size <= MAX_BLOCK_CHARS && size <= remaining) {
      remaining -= size
      highlightBlock(before, after, removed, added, text, ranges)
    }
    start = end
  }
  return ranges
}

function indicesOf(
  types: DiffLineType[],
  start: number,
  end: number,
  type: DiffLineType,
) {
  const indices: number[] = []
  for (let index = start; index < end; index++) {
    if (types[index] === type) indices.push(index)
  }
  return indices
}

function highlightBlock(
  before: string,
  after: string,
  removed: number[],
  added: number[],
  text: string[],
  ranges: TextRange[][],
) {
  // Bound Myers' edit search; large rewrites retain their line backgrounds.
  const changes = diffWordsWithSpace(before, after, { maxEditLength: 256 })
  if (!changes) return
  const oldRanges: TextRange[] = []
  const newRanges: TextRange[] = []
  let oldOffset = 0
  let newOffset = 0

  for (const change of changes) {
    const length = change.value.length
    if (change.removed) {
      oldRanges.push({ start: oldOffset, end: oldOffset + length })
    } else if (change.added) {
      newRanges.push({ start: newOffset, end: newOffset + length })
    }
    if (!change.added) oldOffset += length
    if (!change.removed) newOffset += length
  }
  distributeRanges(removed, text, oldRanges, ranges)
  distributeRanges(added, text, newRanges, ranges)
}

function distributeRanges(
  indices: number[],
  text: string[],
  blockRanges: TextRange[],
  output: TextRange[][],
) {
  let offset = 0
  for (const index of indices) {
    const end = offset + text[index].length
    output[index] = blockRanges.flatMap((range) => {
      const start = Math.max(offset, range.start)
      const stop = Math.min(end, range.end)
      return start < stop ? [{ start: start - offset, end: stop - offset }] : []
    })
    offset = end + 1
  }
}

/** Split a line at changed ranges for the immediate, unhighlighted preview. */
export function diffTextParts(text: string, ranges: TextRange[] = []) {
  const parts: { text: string; changed: boolean }[] = []
  let offset = 0
  for (const range of ranges) {
    if (range.start > offset) {
      parts.push({ text: text.slice(offset, range.start), changed: false })
    }
    parts.push({ text: text.slice(range.start, range.end), changed: true })
    offset = range.end
  }
  if (offset < text.length) {
    parts.push({ text: text.slice(offset), changed: false })
  }
  return parts
}
