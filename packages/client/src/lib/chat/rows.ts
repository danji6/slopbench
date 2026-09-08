import type { UIMessage } from 'ai'
import { dequal } from 'dequal'

import {
  type PartGroup,
  groupHasToolCall,
  groupKey,
  groupPartsCached,
} from './parts'
import type { MessageRecord, PartMetadata } from './types'
import {
  type ReasoningAddress,
  type ResolveWorkId,
  type WorkGroup,
  buildWorkLayout,
  latestReasoning,
} from './work-layout'

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
  | { kind: 'footer'; key: string; messageId: string; grouped?: boolean }
  | { kind: 'hidden'; key: string; messageId: string; grouped?: boolean }

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
  partMeta: PartMetadata | undefined,
): boolean {
  // A processing turn can surface the waiting indicator at any moment
  if ((message as { status?: string }).status === 'processing') return true
  if (meta?.metadata?.error) return true
  if ((meta?.versionCount ?? 1) > 1) return true
  return (partMeta?.duration ?? 0) > 0
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
        ...(grouped && { grouped }),
      })
      continue
    }

    // Summaries and other typed messages never join a sender group
    const senderKey =
      meta?.sender && !meta.type
        ? `${meta.sender.type}:${meta.sender.id}`
        : null
    const grouped =
      groupBySender && senderKey !== null && senderKey === previousSenderKey
    previousSenderKey = senderKey

    const hasHeader = !meta?.type && !grouped

    const slices = segmentGroupsFor(message, meta)
    const reasoning = !meta?.type ? latestReasoning(id, slices) : undefined
    const layout = buildWorkLayout(message, meta, slices, resolveWorkId)
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
      if (entry.workId && !emitted.has(entry.workId)) {
        const work = layout.work.find((work) => work.id === entry.workId)!
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
        ...(entry.workId && { workId: entry.workId }),
        ...(first && grouped && { grouped }),
      })
      first = false
    }

    // Only render a footer if it has something to show or is the first row
    if (first || hasFooterContent(message, meta, getPartMetadata(id))) {
      rows.push({
        kind: 'footer',
        key: firstKey(`f:${id}`),
        messageId: id,
        ...(first && grouped && { grouped }),
      })
    }
  }

  return rows
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
