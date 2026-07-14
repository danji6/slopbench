import { type UIMessage, isReasoningUIPart } from 'ai'

import {
  type PartGroup,
  groupKey,
  groupPartsCached,
  isRenderablePartGroup,
} from './parts'
import type { MessageRecord } from './types'

function isReasoningGroup(group: PartGroup): boolean {
  return group.type === 'single' && isReasoningUIPart(group.part)
}

export type MessageRow =
  | {
      kind: 'header'
      key: string
      messageId: string
      /**
       * When set, the header owns and renders this leading reasoning group
       * (a group index within the message's first loaded segment).
       */
      reasoningGroupIndex?: number
      grouped?: boolean
    }
  | {
      kind: 'group'
      key: string
      messageId: string
      segmentIndex: number
      groupIndex: number
      grouped?: boolean
    }
  | { kind: 'footer'; key: string; messageId: string; grouped?: boolean }

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
}

export function buildRows(
  ids: string[],
  getMessage: (id: string) => UIMessage | null,
  getMessageMetadata: (id: string) => MessageRecord | undefined,
  { groupBySender = false }: BuildRowsOptions = {},
): MessageRow[] {
  const rows: MessageRow[] = []
  let previousSenderKey: string | null = null

  for (const id of ids) {
    const message = getMessage(id)
    if (!message) continue

    const meta = getMessageMetadata(id)
    const isSystem = message.role === 'system'
    // Summaries and other typed messages never join a sender group
    const senderKey =
      meta?.sender && !meta.type
        ? `${meta.sender.type}:${meta.sender.id}`
        : null
    const grouped =
      groupBySender && senderKey !== null && senderKey === previousSenderKey
    previousSenderKey = senderKey

    const hasHeader =
      (meta?.senderSnapshot?.name || isSystem) && !meta?.type && !grouped

    const slices = segmentGroupsFor(message, meta)
    const firstGroups = slices[0]?.groups ?? []
    // The leading group is the first reasoning or otherwise renderable group,
    // skipping inert parts like `step-start` that the SDK prepends. It only
    // folds into the header when the turn's actual start is loaded.
    const leadIndex = firstGroups.findIndex(
      (group) => isReasoningGroup(group) || isRenderablePartGroup(group),
    )
    const reasoningGroupIndex =
      hasHeader &&
      !meta?.hasOlderSegments &&
      leadIndex >= 0 &&
      isReasoningGroup(firstGroups[leadIndex])
        ? leadIndex
        : undefined

    // A `:grp` suffix on the first emitted row's key lets `rowKeysEqual`
    // catch grouping toggles even when no header row appears or vanishes
    let first = true
    const firstKey = (key: string) => (first && grouped ? `${key}:grp` : key)

    if (hasHeader) {
      rows.push({
        kind: 'header',
        key: reasoningGroupIndex !== undefined ? `h:${id}:r` : `h:${id}`,
        messageId: id,
        reasoningGroupIndex,
      })
      first = false
    }

    for (const [sliceIndex, slice] of slices.entries()) {
      for (let i = 0; i < slice.groups.length; i++) {
        if (sliceIndex === 0 && i === reasoningGroupIndex) continue
        if (!isRenderablePartGroup(slice.groups[i])) continue
        rows.push({
          kind: 'group',
          key: firstKey(
            `g:${id}:s${slice.segmentIndex}:${groupKey(slice.groups[i])}`,
          ),
          messageId: id,
          segmentIndex: slice.segmentIndex,
          groupIndex: i,
          ...(first && grouped && { grouped }),
        })
        first = false
      }
    }

    rows.push({
      kind: 'footer',
      key: firstKey(`f:${id}`),
      messageId: id,
      ...(first && grouped && { grouped }),
    })
  }

  return rows
}

export function rowKeysEqual(a: MessageRow[], b: MessageRow[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key) return false
  }
  return true
}
