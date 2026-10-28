import type { RowTransition } from './row-expansion-state'
import type { MessageRow } from './rows'

/** Adds a header to each uninterrupted run of two or more hidden messages. */
export function groupNoteRows(rows: MessageRow[]): MessageRow[] {
  const result: MessageRow[] = []
  let index = 0
  while (index < rows.length) {
    const first = rows[index]
    if (first.kind !== 'hidden') {
      result.push(first)
      index++
      continue
    }
    let end = index + 1
    while (rows[end]?.kind === 'hidden') end++
    const count = end - index
    if (count === 1) result.push(first)
    else {
      const key = `notes:${first.messageId}`
      result.push({
        kind: 'note-group',
        key,
        messageId: first.messageId,
        count,
        ...(first.grouped && { grouped: true }),
      })
      for (const row of rows.slice(index, end)) {
        if (row.kind === 'hidden') result.push({ ...row, noteGroupId: key })
      }
    }
    index = end
  }
  return result
}

/** Hides collapsed groups' children while retaining individual message rows. */
export function projectNoteRows(
  rows: MessageRow[],
  open: ReadonlySet<string>,
  transitions?: ReadonlyMap<string, RowTransition>,
): MessageRow[] {
  return rows.filter((row) => {
    if (row.kind !== 'hidden' || !row.noteGroupId) return true
    if (open.has(row.noteGroupId)) return true
    const transition = transitions?.get(row.noteGroupId)
    return (
      transition?.phase === 'closing' && transition.mountedRows.has(row.key)
    )
  })
}
