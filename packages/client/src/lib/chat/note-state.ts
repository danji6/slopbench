import { createRowExpansionStore } from './row-expansion-state'
import type { MessageRow } from './rows'

export { createRowExpansionStore as createNoteExpansionStore } from './row-expansion-state'

/** Keeps note and group expansion independent of virtualized row mounts. */
export const noteExpansion = createRowExpansionStore()

export const noteContentKey = (messageId: string) => `note:${messageId}`

/** Reveals a note; returns whether its group needs a projected-row update. */
export function revealNote(row: Extract<MessageRow, { kind: 'hidden' }>) {
  noteExpansion.setOpen(noteContentKey(row.messageId), true)
  if (!row.noteGroupId) return false
  if (noteExpansion.getSnapshot().has(row.noteGroupId)) return false
  noteExpansion.setOpen(row.noteGroupId, true)
  return true
}
