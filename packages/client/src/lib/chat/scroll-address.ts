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
  if (!toolCallId) {
    const group = row.work.groups[0]
    return group ? { kind: 'group', ...group } : undefined
  }

  const message = reader.getMessage(row.messageId)
  if (!message) return

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
  let reportWork: MessageRow | undefined
  let reasoningHeader: MessageRow | undefined

  for (const row of rows) {
    if (row.kind === 'header' && address.kind === 'group') {
      const reasoning = row.reasoning
      if (
        reasoning?.messageId === messageId &&
        reasoning.segmentIndex === address.segmentIndex &&
        reasoning.groupIndex === address.groupIndex
      ) {
        reasoningHeader = row
      }
    }
    if (row.messageId !== messageId) continue

    if (address.kind === 'group') {
      if (row.kind === 'work' && !row.work.toolCallIds.length) {
        const containsReport = row.work.groups.some(
          (group) =>
            group.segmentIndex === address.segmentIndex &&
            group.groupIndex === address.groupIndex,
        )
        if (containsReport) reportWork = row
      }
      const matchesGroup =
        row.kind === 'group' &&
        row.segmentIndex === address.segmentIndex &&
        row.groupIndex === address.groupIndex
      if (matchesGroup) return row
      continue
    }

    const matchesWork =
      row.kind === 'work' && row.work.toolCallIds.includes(address.toolCallId)
    if (matchesWork) return row
  }

  return reportWork ?? reasoningHeader
}
