import type { MessageStore, WindowBoundary } from './message-store'
import { isRenderablePartGroup } from './parts'
import { type MessageRow, segmentGroupsFor } from './rows'
import type { MessageRecord } from './types'

type MessageReader = Pick<MessageStore, 'getMessage' | 'getMessageMetadata'>
type GroupRow = Extract<MessageRow, { kind: 'group' }>

/** Compares database positions, including segments within the same message. */
export function compareBoundaries(
  a: WindowBoundary,
  b: WindowBoundary,
): number {
  if (a._creationTime !== b._creationTime) {
    return a._creationTime - b._creationTime
  }
  if (a._id !== b._id) return a._id < b._id ? -1 : 1
  return a.segmentIndex - b.segmentIndex
}

/** Finds the chronological edge even when notes have been reordered for display. */
export function oldestLoadedBoundary(
  records: ReadonlyMap<string, MessageRecord>,
): WindowBoundary | null {
  let oldest: WindowBoundary | null = null
  for (const [_id, record] of records) {
    const boundary = {
      _id,
      _creationTime: record._creationTime,
      segmentIndex: record.segments[0]?.index ?? 0,
      selectedVersion: record.selectedVersion,
      hasOlderSegments: record.hasOlderSegments,
    }
    if (!oldest || compareBoundaries(boundary, oldest) < 0) oldest = boundary
  }
  return oldest
}

/** Detects newly fetched body content using the transcript's projected rows. */
export function hasVisibleOlderContent(
  rows: readonly MessageRow[],
  before: WindowBoundary,
  reader: MessageReader,
  openWork: ReadonlySet<string>,
): boolean {
  return rows.some((row) => {
    const record = reader.getMessageMetadata(row.messageId)
    if (!record || !rowPrecedesBoundary(row, record, before)) return false
    switch (row.kind) {
      case 'group':
        return isExposedGroup(row, record, reader, openWork)
      case 'hidden':
      case 'note-group':
        return true
      case 'footer':
        return Boolean(record.metadata?.error)
      default:
        return false
    }
  })
}

/** Excludes folded children retained temporarily for their closing animation. */
function isExposedGroup(
  row: GroupRow,
  record: MessageRecord,
  reader: MessageReader,
  openWork: ReadonlySet<string>,
): boolean {
  const message = reader.getMessage(row.messageId)
  if (!message) return false
  const slice = segmentGroupsFor(message, record).find(
    (slice) => slice.segmentIndex === row.segmentIndex,
  )
  const group = slice?.groups[row.groupIndex]
  const exposed =
    !row.workId || openWork.has(row.workId) || row.promotedToolCallIds?.length
  return Boolean(group && isRenderablePartGroup(group) && exposed)
}

function rowPrecedesBoundary(
  row: MessageRow,
  record: MessageRecord,
  before: WindowBoundary,
): boolean {
  const position = {
    _id: row.messageId,
    _creationTime: record._creationTime,
    segmentIndex: row.kind === 'group' ? row.segmentIndex : 0,
    selectedVersion: record.selectedVersion,
    hasOlderSegments: record.hasOlderSegments,
  }
  if (row.messageId === before._id && row.kind !== 'group') return false
  return compareBoundaries(position, before) < 0
}
