import type { MessageStore } from './message-store'
import { groupHasToolCall } from './parts'
import { type MessageRow, segmentGroupsFor } from './rows'

/** A content address that survives rebuilding rows after a reload. */
export type ScrollRowAddress =
  | { kind: 'group'; segmentIndex: number; groupIndex: number }
  | { kind: 'work'; segmentIndex: number; toolCallId: string }

type MessageReader = Pick<MessageStore, 'getMessage' | 'getMessageMetadata'>

/** Addresses a body row without relying on its generated work or sender key. */
export function scrollRowAddress(
  row: MessageRow,
  reader: MessageReader,
): ScrollRowAddress | undefined {
  if (row.kind === 'group') {
    return {
      kind: 'group',
      segmentIndex: row.segmentIndex,
      groupIndex: row.groupIndex,
    }
  }
  if (row.kind !== 'work') return
  const toolCallId = row.work.toolCallIds[0]
  const message = reader.getMessage(row.messageId)
  if (!toolCallId || !message) return
  const segment = segmentGroupsFor(
    message,
    reader.getMessageMetadata(row.messageId),
  ).find((slice) =>
    slice.groups.some((group) => groupHasToolCall(group, toolCallId)),
  )
  if (!segment) return
  return { kind: 'work', segmentIndex: segment.segmentIndex, toolCallId }
}

/** Resolves saved content even when the current row has a different key. */
export function findScrollContentRow(
  rows: readonly MessageRow[],
  messageId: string,
  address: ScrollRowAddress,
): MessageRow | undefined {
  return rows.find((row) => {
    if (row.messageId !== messageId) return false
    if (address.kind === 'group') {
      return (
        row.kind === 'group' &&
        row.segmentIndex === address.segmentIndex &&
        row.groupIndex === address.groupIndex
      )
    }
    return (
      row.kind === 'work' && row.work.toolCallIds.includes(address.toolCallId)
    )
  })
}
