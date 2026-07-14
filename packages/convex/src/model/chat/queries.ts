import type { MessageWindowArgs } from '@sb/convex/types'
import {
  MESSAGE_WINDOW_BUDGET_BYTES,
  MESSAGE_WINDOW_MAX_ROWS,
} from '@sb/core/const'
import { serializedSize } from '@sb/core/utils/size'
import { type IndexKey, getPage } from 'convex-helpers/server/pagination'
import type { PaginationOptions } from 'convex/server'

import type { Doc, Id } from '../../_generated/dataModel'
import type { AuthQueryCtx } from '../../functions'
import schema from '../../schema'
import { listSelectedSegments, withParts } from '../messageContents'
import { textFromParts } from '../messages'
import * as Memberships from '../session/memberships'
import { hasOutputRef } from '../stream/toolOutput'

/** One loaded segment of a window message. */
export type WindowSegment = {
  segmentIndex: number
  parts: unknown[]
  sizeBytes: number
}

/** A window message carrying an ascending contiguous slice of its segments. */
export type WindowMessage = Doc<'messages'> & {
  segments: WindowSegment[]
  /** Sum of the loaded segments' serialized sizes. */
  sizeBytes: number
  hasOlderSegments: boolean
  hasNewerSegments: boolean
}

export type MessagesWindowResult = {
  /** Messages in ascending (oldest-first) order, joined with selected parts. */
  page: WindowMessage[]
  /** Whether messages exist older than the window's lower bound. */
  hasOlder: boolean
  /** Whether messages exist newer than the window's upper bound. */
  hasNewer: boolean
  /** Whether the window is pinned to the newest message (live mode). */
  atTail: boolean
}

/** A bounded, reactive slice of a session's messages backed by `getPage`. */
export async function messagesWindow(
  ctx: AuthQueryCtx,
  {
    sessionId,
    anchor,
    direction,
    limit,
    budgetBytes,
    anchorSegment,
  }: MessageWindowArgs,
): Promise<MessagesWindowResult> {
  const member = await Memberships.getMember(ctx, sessionId, ctx.userId)
  if (!member) {
    return { page: [], hasOlder: false, hasNewer: false, atTail: true }
  }

  const sessionPrefix: IndexKey = [sessionId]
  const rowCap = Math.min(limit, MESSAGE_WINDOW_MAX_ROWS)
  const budget =
    budgetBytes === undefined
      ? undefined
      : Math.min(budgetBytes, MESSAGE_WINDOW_BUDGET_BYTES)

  if (direction === 'older') {
    const result = await getPage(ctx, {
      table: 'messages',
      index: 'by_sessionId',
      schema,
      order: 'desc',
      startIndexKey: anchor ?? sessionPrefix,
      startInclusive: true,
      endIndexKey: sessionPrefix,
      endInclusive: true,
      absoluteMaxRows: rowCap,
    })
    // Rows arrive anchor-first (newest first); join outward, then restore
    // ascending order
    const { messages, trimmed } = await joinSegmentsWithinBudget(
      ctx,
      result.page,
      budget,
      { direction: 'older', anchorSegment },
    )
    const page = messages.reverse()
    const hasNewer =
      (anchor
        ? await messagesExistBeyond(ctx, sessionPrefix, anchor, 'newer')
        : false) ||
      (page.at(-1)?.hasNewerSegments ?? false)
    return {
      page,
      hasOlder:
        result.hasMore || trimmed || (page[0]?.hasOlderSegments ?? false),
      hasNewer,
      atTail: !hasNewer,
    }
  }

  const result = await getPage(ctx, {
    table: 'messages',
    index: 'by_sessionId',
    schema,
    order: 'asc',
    startIndexKey: anchor ?? sessionPrefix,
    startInclusive: true,
    endIndexKey: sessionPrefix,
    endInclusive: true,
    absoluteMaxRows: rowCap,
  })
  const { messages, trimmed } = await joinSegmentsWithinBudget(
    ctx,
    result.page,
    budget,
    { direction: 'newer', anchorSegment },
  )
  const hasOlder =
    (anchor
      ? await messagesExistBeyond(ctx, sessionPrefix, anchor, 'older')
      : false) ||
    (messages[0]?.hasOlderSegments ?? false)
  const hasNewer =
    result.hasMore || trimmed || (messages.at(-1)?.hasNewerSegments ?? false)
  return {
    page: messages,
    hasOlder,
    hasNewer,
    atTail: !hasNewer,
  }
}

/**
 * Joins rows with their selected segments anchor-outward, stopping once the
 * accumulated serialized size passes the budget. May stop mid-message: the
 * message then keeps the anchor-side slice of its segments and flags the
 * missing side. Always yields at least one segment.
 */
export async function joinSegmentsWithinBudget(
  ctx: AuthQueryCtx,
  rows: Doc<'messages'>[],
  budget: number | undefined,
  {
    direction,
    anchorSegment,
  }: { direction: 'older' | 'newer'; anchorSegment?: number },
): Promise<{ messages: WindowMessage[]; trimmed: boolean }> {
  const messages: WindowMessage[] = []
  let total = 0
  let loadedCount = 0

  const exhausted = () =>
    budget !== undefined && loadedCount > 0 && total >= budget

  for (const [index, row] of rows.entries()) {
    if (exhausted()) return { messages, trimmed: true }

    const allSegments = await listSelectedSegments(ctx, row)
    // The anchor message may enter the page from a mid-message seam
    const sliced =
      index === 0 && anchorSegment !== undefined
        ? allSegments.filter((segment) =>
            direction === 'older'
              ? segment.segmentIndex <= anchorSegment
              : segment.segmentIndex >= anchorSegment,
          )
        : allSegments

    // Walk segments closest-to-anchor first so a budget stop keeps the
    // anchor-side slice
    const ordered = direction === 'older' ? [...sliced].reverse() : sliced

    const loaded: WindowSegment[] = []
    let partial = false
    for (const segment of ordered) {
      if (exhausted()) {
        partial = true
        break
      }
      const parts = stripLinkSnapshotParts(segment.parts)
      const sizeBytes = serializedSize(parts)
      loaded.push({ segmentIndex: segment.segmentIndex, parts, sizeBytes })
      total += sizeBytes
      loadedCount++
    }

    if (loaded.length === 0 && sliced.length > 0) {
      // Budget ran out before any segment of this message fit
      return { messages, trimmed: true }
    }

    const ascending = direction === 'older' ? loaded.reverse() : loaded
    const segments =
      ascending.length > 0
        ? ascending
        : [{ segmentIndex: 0, parts: [], sizeBytes: 0 }]

    const minLoaded = segments[0].segmentIndex
    const maxLoaded = segments[segments.length - 1].segmentIndex
    messages.push({
      ...row,
      segments,
      sizeBytes: segments.reduce((sum, segment) => sum + segment.sizeBytes, 0),
      hasOlderSegments: allSegments.some(
        (segment) => segment.segmentIndex < minLoaded,
      ),
      hasNewerSegments: allSegments.some(
        (segment) => segment.segmentIndex > maxLoaded,
      ),
    })

    if (partial) return { messages, trimmed: true }
  }

  return { messages, trimmed: false }
}

/** Strip link part snapshots before sending parts to clients. */
function stripLinkSnapshotParts(parts: unknown[]): unknown[] {
  if (
    !parts.some(
      (part) => isSnapshottedFileLink(part) || isSnapshottedPlanLink(part),
    )
  ) {
    return parts
  }
  return parts.map((part) => {
    if (isSnapshottedFileLink(part)) {
      const { snapshot: _snapshot, ...rest } = part
      return rest
    }
    if (isSnapshottedPlanLink(part)) {
      // Keep the status for the client, drop the plan content
      return { ...part, snapshot: { status: part.snapshot.status } }
    }
    return part
  })
}

function isSnapshottedFileLink(
  part: unknown,
): part is { type: 'file-link'; snapshot?: unknown } {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'file-link' &&
    'snapshot' in part
  )
}

function isSnapshottedPlanLink(
  part: unknown,
): part is { type: 'plan-link'; snapshot: { status: string } } {
  if (
    typeof part !== 'object' ||
    part === null ||
    (part as { type?: unknown }).type !== 'plan-link'
  ) {
    return false
  }
  const snapshot = (part as { snapshot?: unknown }).snapshot
  return typeof snapshot === 'object' && snapshot !== null
}

/** Check if any message sits beyond a boundary key. */
async function messagesExistBeyond(
  ctx: AuthQueryCtx,
  sessionPrefix: IndexKey,
  key: IndexKey,
  direction: 'older' | 'newer',
): Promise<boolean> {
  const result = await getPage(ctx, {
    table: 'messages',
    index: 'by_sessionId',
    schema,
    order: direction === 'older' ? 'desc' : 'asc',
    startIndexKey: key,
    startInclusive: false,
    endIndexKey: sessionPrefix,
    endInclusive: true,
    absoluteMaxRows: 1,
  })
  return result.page.length > 0
}

export type MessageSearchResult = {
  _id: Id<'messages'>
  _creationTime: number
  /** Which segment of the message matched (for seek anchoring). */
  segmentIndex: number
  role: Doc<'messages'>['role']
  sender: Doc<'messages'>['sender']
  senderSnapshot: Doc<'messages'>['senderSnapshot']
  text: string
}

export async function searchMessages(
  ctx: AuthQueryCtx,
  {
    sessionId,
    term,
    paginationOpts,
  }: {
    sessionId: Id<'sessions'>
    term: string
    paginationOpts: PaginationOptions
  },
) {
  const member = await Memberships.getMember(ctx, sessionId, ctx.userId)
  if (!member || !term.trim()) {
    return { page: [], isDone: true, continueCursor: '' }
  }

  const result = await ctx.db
    .query('messageContents')
    .withSearchIndex('search_contents', (q) =>
      q.search('searchText', term).eq('sessionId', sessionId),
    )
    .paginate(paginationOpts)

  // Hits on non-selected versions are dropped (pages may run short)
  const hits = await Promise.all(
    result.page.map(async (row) => {
      const message = await ctx.db.get(row.messageId)
      if (!message || row.version !== message.selectedVersion) return null
      return toSearchResult(message, row)
    }),
  )

  return {
    ...result,
    page: hits.filter((hit): hit is MessageSearchResult => hit !== null),
  }
}

function toSearchResult(
  message: Doc<'messages'>,
  row: Doc<'messageContents'>,
): MessageSearchResult {
  return {
    _id: message._id,
    _creationTime: message._creationTime,
    segmentIndex: row.segmentIndex,
    role: message.role,
    sender: message.sender,
    senderSnapshot: message.senderSnapshot,
    text: row.searchText ?? '',
  }
}

export async function listFirstHumanMessage(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await Memberships.requireMember(ctx, sessionId, ctx.userId)

  const message = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_senderType', (q) =>
      q.eq('sessionId', sessionId).eq('sender.type', 'user'),
    )
    .order('asc')
    .first()
  if (!message) return null

  const joined = await withParts(ctx, message)

  return textFromParts(joined.parts)
}

export async function getActiveStream(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const member = await Memberships.getMember(ctx, sessionId, ctx.userId)
  if (!member) return null
  return Memberships.getActiveStream(ctx, sessionId)
}

export async function getToolOutputUrl(
  ctx: AuthQueryCtx,
  { messageId, toolCallId }: { messageId: Id<'messages'>; toolCallId: string },
) {
  const message = await ctx.db.get(messageId)
  if (!message) return null

  const member = await Memberships.getMember(ctx, message.sessionId, ctx.userId)
  if (!member) return null

  const joined = await withParts(ctx, message)
  const part = joined.parts.find(
    (candidate) =>
      hasOutputRef(candidate) &&
      (candidate as { toolCallId?: string }).toolCallId === toolCallId,
  )
  if (!part || !hasOutputRef(part)) return null

  return ctx.storage.getUrl(part.outputRef)
}
