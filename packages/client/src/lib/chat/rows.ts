import type { UIMessage } from 'ai'
import { dequal } from 'dequal'

import { groupNoteRows } from './note-rows'
import {
  type PartGroup,
  groupHasToolCall,
  groupKey,
  groupPartsCached,
} from './parts'
import { messageSenderKey, senderGroupDurations } from './sender-groups'
import { groupShellReportRows } from './shell-work-reports'
import type { MessageRecord, PartMetadata } from './types'
import {
  type ReasoningAddress,
  type ResolveWorkId,
  type WorkGroup,
  buildWorkLayout,
  latestReasoning,
} from './work-layout'

export type HiddenChipPlacement = 'standalone' | 'inline' | 'grouped'

export type MessageRow =
  | {
      kind: 'header'
      key: string
      messageId: string
      reasoning?: ReasoningAddress
      grouped?: boolean
    }
  | {
      kind: 'group'
      key: string
      messageId: string
      segmentIndex: number
      groupIndex: number
      /** Uses compaction spacing for all groups, including its thinking. */
      summary?: boolean
      workId?: string
      promotedToolCallIds?: string[]
      grouped?: boolean
    }
  | {
      kind: 'work'
      key: string
      messageId: string
      work: WorkGroup
      grouped?: boolean
    }
  | {
      kind: 'footer'
      key: string
      messageId: string
      duration?: number
      grouped?: boolean
    }
  | {
      kind: 'note-group'
      key: string
      messageId: string
      count: number
      grouped?: boolean
    }
  | {
      kind: 'hidden'
      key: string
      messageId: string
      placement: HiddenChipPlacement
      noteGroupId?: string
      grouped?: boolean
    }

/** One loaded segment's part slice with its cached part groups. */
export type SegmentGroups = {
  segmentIndex: number
  parts: UIMessage['parts']
  groups: PartGroup[]
}

const sliceCache = new WeakMap<
  UIMessage['parts'],
  { signature: string; slices: SegmentGroups[] }
>()

/**
 * Splits a message's flattened parts back into segment slices, cached
 * for stable lookups.
 */
export function segmentGroupsFor(
  message: UIMessage,
  record: MessageRecord | undefined,
): SegmentGroups[] {
  const segments = record?.segments ?? []
  const signature = segments
    .map((segment) => `${segment.index}:${segment.partCount}`)
    .join(',')

  const cached = sliceCache.get(message.parts)
  if (cached && cached.signature === signature) return cached.slices

  let slices: SegmentGroups[]
  if (segments.length <= 1) {
    slices = [
      {
        segmentIndex: segments[0]?.index ?? 0,
        parts: message.parts,
        groups: groupPartsCached(message.parts),
      },
    ]
  } else {
    slices = []
    let offset = 0
    for (const segment of segments) {
      const parts = message.parts.slice(offset, offset + segment.partCount)
      offset += segment.partCount
      slices.push({
        segmentIndex: segment.index,
        parts,
        groups: groupPartsCached(parts),
      })
    }
  }

  sliceCache.set(message.parts, { signature, slices })
  return slices
}

export type BuildRowsOptions = {
  /** Collapse consecutive messages by the same sender under one header. */
  groupBySender?: boolean
  resolveWorkId?: ResolveWorkId
}

/** Whether a footer row would render anything. */
function hasFooterContent(
  message: UIMessage,
  meta: MessageRecord | undefined,
  duration: number | undefined,
): boolean {
  // A processing turn can surface the waiting indicator at any moment
  if ((message as { status?: string }).status === 'processing') return true
  if (meta?.hasChanges) return true
  if (meta?.metadata?.error) return true
  if ((meta?.versionCount ?? 1) > 1) return true
  return duration !== undefined
}

export function buildRows(
  ids: string[],
  getMessage: (id: string) => UIMessage | null,
  getMessageMetadata: (id: string) => MessageRecord | undefined,
  getPartMetadata: (id: string) => PartMetadata | undefined = () => undefined,
  { groupBySender = false, resolveWorkId }: BuildRowsOptions = {},
): MessageRow[] {
  const rows: MessageRow[] = []
  let previousSenderKey: string | null = null
  let senderHeader: Extract<MessageRow, { kind: 'header' }> | undefined
  const durations = senderGroupDurations({
    ids,
    getMessage,
    getMetadata: getMessageMetadata,
    getPartMetadata,
    groupBySender,
  })

  for (const id of ids) {
    const message = getMessage(id)
    if (!message) continue

    const meta = getMessageMetadata(id)
    // Hidden messages render as a single compact chip (styled by type).
    // Leaving the sender key untouched keeps grouping stable across them.
    if (meta?.hidden) {
      const grouped = groupBySender && previousSenderKey !== null
      rows.push({
        kind: 'hidden',
        key: `hid:${id}`,
        messageId: id,
        placement: 'standalone',
        ...(grouped && { grouped }),
      })
      continue
    }

    // Summaries and other typed messages never join a sender group
    const senderKey = messageSenderKey(message, meta)
    const grouped =
      groupBySender && senderKey !== null && senderKey === previousSenderKey
    previousSenderKey = senderKey

    const hasHeader = (!meta?.type || message.role === 'system') && !grouped

    const slices = segmentGroupsFor(message, meta)
    const reasoning = !meta?.type ? latestReasoning(id, slices) : undefined
    const layout = buildWorkLayout(message, meta, slices, resolveWorkId)
    const summarizedWork = new Map(
      layout.work
        .filter((work) => work.groups.length > 1 || work.toolCallIds.length > 0)
        .map((work) => [work.id, work]),
    )
    if (!grouped) senderHeader = undefined
    if (grouped && senderHeader && reasoning) senderHeader.reasoning = reasoning

    // A `:grp` suffix on the first emitted row's key lets `rowKeysEqual`
    // catch grouping toggles even when no header row appears or vanishes
    let first = true
    const firstKey = (key: string) => (first && grouped ? `${key}:grp` : key)

    if (hasHeader) {
      senderHeader = {
        kind: 'header',
        key: `h:${id}`,
        messageId: id,
        reasoning,
      }
      rows.push(senderHeader)
      first = false
    }

    const emitted = new Set<string>()
    for (const entry of layout.groups) {
      const work = entry.workId ? summarizedWork.get(entry.workId) : undefined
      if (work && !emitted.has(work.id)) {
        rows.push({
          kind: 'work',
          key: firstKey(`w:${work.id}`),
          messageId: id,
          work,
          ...(first && grouped && { grouped }),
        })
        emitted.add(work.id)
        first = false
      }
      rows.push({
        kind: 'group',
        key: firstKey(
          `g:${id}:s${entry.segmentIndex}:${groupKey(entry.group)}`,
        ),
        messageId: id,
        segmentIndex: entry.segmentIndex,
        groupIndex: entry.groupIndex,
        ...(meta?.type === 'summary' && { summary: true }),
        ...(work && { workId: work.id }),
        ...(first && grouped && { grouped }),
      })
      first = false
    }

    // Only render a footer if it has something to show or is the first row
    const duration = durations.get(id)
    if (first || hasFooterContent(message, meta, duration)) {
      rows.push({
        kind: 'footer',
        key: firstKey(`f:${id}`),
        messageId: id,
        ...(duration !== undefined && { duration }),
        ...(first && grouped && { grouped }),
      })
    }
  }

  return groupNoteRows(
    groupShellReportRows(rows, {
      getMessage,
      getMetadata: getMessageMetadata,
      getSegments: segmentGroupsFor,
      groupBySender,
      resolveWorkId,
    }),
  )
}

/**
 * The row rendering a tool call, for sub-message precision. Absent when the
 * segment holding the call isn't loaded.
 */
export function findToolRow(
  rows: MessageRow[],
  message: UIMessage,
  record: MessageRecord | undefined,
  toolCallId: string,
): MessageRow | undefined {
  for (const slice of segmentGroupsFor(message, record)) {
    const groupIndex = slice.groups.findIndex((group) =>
      groupHasToolCall(group, toolCallId),
    )
    if (groupIndex < 0) continue

    return (
      rows.find(
        (row) =>
          row.kind === 'group' &&
          row.messageId === message.id &&
          row.segmentIndex === slice.segmentIndex &&
          row.groupIndex === groupIndex,
      ) ??
      rows.find(
        (row) =>
          row.kind === 'work' &&
          row.messageId === message.id &&
          row.work.toolCallIds.includes(toolCallId),
      )
    )
  }
}

export function rowKeysEqual(a: MessageRow[], b: MessageRow[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!dequal(a[i], b[i])) return false
  }
  return true
}
