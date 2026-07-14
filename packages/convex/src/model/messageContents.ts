import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import { isContextEligible, searchTextFromParts } from './messages'
import { collectToolOutputStorageIds } from './stream/toolOutput'

/** A message doc joined with its selected version's parts (concatenated segments). */
export type MessageWithParts = Doc<'messages'> & { parts: unknown[] }

type InsertMessageFields = {
  sessionId: Id<'sessions'>
  sender: Doc<'messages'>['sender']
  role: Doc<'messages'>['role']
  senderSnapshot?: Doc<'messages'>['senderSnapshot']
  type?: Doc<'messages'>['type']
  status: Doc<'messages'>['status']
  metadata?: Doc<'messages'>['metadata']
}

/** Point read of a single segment row. */
export function getSegmentRow(
  ctx: QueryCtx,
  messageId: Id<'messages'>,
  version: number,
  segmentIndex: number,
) {
  return ctx.db
    .query('messageContents')
    .withIndex('by_messageId_version_segment', (q) =>
      q
        .eq('messageId', messageId)
        .eq('version', version)
        .eq('segmentIndex', segmentIndex),
    )
    .unique()
}

/** All segment rows of one version, in ascending segment order. */
export function listSegments(
  ctx: QueryCtx,
  messageId: Id<'messages'>,
  version: number,
) {
  return ctx.db
    .query('messageContents')
    .withIndex('by_messageId_version_segment', (q) =>
      q.eq('messageId', messageId).eq('version', version),
    )
    .collect()
}

export function listSelectedSegments(ctx: QueryCtx, message: Doc<'messages'>) {
  return listSegments(ctx, message._id, message.selectedVersion)
}

/** The last segment row of the selected version (the one a stream writes to). */
export function getActiveSegmentRow(ctx: QueryCtx, message: Doc<'messages'>) {
  return ctx.db
    .query('messageContents')
    .withIndex('by_messageId_version_segment', (q) =>
      q.eq('messageId', message._id).eq('version', message.selectedVersion),
    )
    .order('desc')
    .first()
}

/** Every content row of a message across all versions (for cleanup). */
export function listAllRows(ctx: QueryCtx, messageId: Id<'messages'>) {
  return ctx.db
    .query('messageContents')
    .withIndex('by_messageId_version_segment', (q) =>
      q.eq('messageId', messageId),
    )
    .collect()
}

/** The first segment row of each version (for switcher previews). */
export async function listVersionHeads(
  ctx: QueryCtx,
  message: Doc<'messages'>,
) {
  const heads = await Promise.all(
    Array.from({ length: message.versionCount }, (_, index) =>
      ctx.db
        .query('messageContents')
        .withIndex('by_messageId_version_segment', (q) =>
          q.eq('messageId', message._id).eq('version', index + 1),
        )
        .first(),
    ),
  )
  return heads.filter((row) => row !== null)
}

/** The segment row a stream is writing to (falls back to the active one). */
export async function getProcessingSegmentRow(
  ctx: QueryCtx,
  stream: Doc<'streams'>,
) {
  if (stream.processingContentId) return ctx.db.get(stream.processingContentId)
  if (!stream.processingMessageId) return null
  const message = await ctx.db.get(stream.processingMessageId)
  return message ? getActiveSegmentRow(ctx, message) : null
}

export async function withParts(
  ctx: QueryCtx,
  message: Doc<'messages'>,
): Promise<MessageWithParts> {
  const segments = await listSelectedSegments(ctx, message)
  return { ...message, parts: segments.flatMap((segment) => segment.parts) }
}

export function withPartsMany(
  ctx: QueryCtx,
  messages: Doc<'messages'>[],
): Promise<MessageWithParts[]> {
  return Promise.all(messages.map((message) => withParts(ctx, message)))
}

/** Parts from every version of a message (for cleanup). */
export async function allVersionParts(
  ctx: QueryCtx,
  messageId: Id<'messages'>,
): Promise<unknown[]> {
  const rows = await listAllRows(ctx, messageId)
  return rows.flatMap((row) => row.parts)
}

/** Inserts a message doc plus its (version 1, segment 0) content row. */
export async function insertMessage(
  ctx: MutationCtx,
  fields: InsertMessageFields,
  parts: unknown[],
) {
  const messageId = await ctx.db.insert('messages', {
    ...fields,
    selectedVersion: 1,
    versionCount: 1,
    contextEligible: isContextEligible(parts),
  })

  const contentId = await ctx.db.insert('messageContents', {
    messageId,
    sessionId: fields.sessionId,
    version: 1,
    segmentIndex: 0,
    parts,
    metadata: fields.metadata,
    senderSnapshot: fields.senderSnapshot,
    searchText: searchTextFromParts(parts),
  })

  return { messageId, contentId }
}

type AddVersionArgs = {
  message: Doc<'messages'>
  parts?: unknown[]
  senderSnapshot?: Doc<'messages'>['senderSnapshot']
}

/** Appends a fresh version and selects it (used by Retry). */
export async function addVersion(
  ctx: MutationCtx,
  { message, parts = [], senderSnapshot }: AddVersionArgs,
) {
  const version = message.versionCount + 1

  const contentId = await ctx.db.insert('messageContents', {
    messageId: message._id,
    sessionId: message.sessionId,
    version,
    segmentIndex: 0,
    parts,
    senderSnapshot,
    searchText: searchTextFromParts(parts),
  })

  await ctx.db.patch(message._id, {
    selectedVersion: version,
    versionCount: version,
    senderSnapshot: senderSnapshot ?? message.senderSnapshot,
    contextEligible: isContextEligible(parts),
    metadata: undefined,
  })

  return { contentId, version }
}

/** Appends an empty segment after the active one (used by the byte-cap split). */
export function appendSegment(
  ctx: MutationCtx,
  activeRow: Doc<'messageContents'>,
) {
  return ctx.db.insert('messageContents', {
    messageId: activeRow.messageId,
    sessionId: activeRow.sessionId,
    version: activeRow.version,
    segmentIndex: activeRow.segmentIndex + 1,
    parts: [],
  })
}

/** Streams a segment row's parts, re-deriving the doc's eligibility cheaply. */
export async function patchSegmentParts(
  ctx: MutationCtx,
  messageId: Id<'messages'>,
  row: Doc<'messageContents'>,
  parts: unknown[],
) {
  await ctx.db.patch(row._id, { parts })
  await ctx.db.patch(messageId, {
    // Earlier sealed segments always carry parts
    contextEligible: row.segmentIndex > 0 || isContextEligible(parts),
  })
}

/** Writes a segment's final parts, search text and metadata slice. */
export async function sealSegment(
  ctx: MutationCtx,
  row: Doc<'messageContents'>,
  parts: unknown[],
  metadata?: Doc<'messages'>['metadata'],
) {
  await ctx.db.patch(row._id, {
    parts,
    searchText: searchTextFromParts(parts),
    metadata,
  })
}

type FinalizeTurnArgs = {
  message: Doc<'messages'>
  row: Doc<'messageContents'>
  parts: unknown[]
  metadata?: Doc<'messages'>['metadata']
}

/** Seals the active segment and finalizes the turn's message doc. */
export async function finalizeTurn(
  ctx: MutationCtx,
  { message, row, parts, metadata }: FinalizeTurnArgs,
) {
  await sealSegment(ctx, row, parts, metadata)

  const segments = await listSelectedSegments(ctx, message)
  await ctx.db.patch(message._id, {
    status: 'done',
    contextEligible: segments.some((segment) => segment.parts.length > 0),
    metadata: mergeSegmentMetadata(segments),
  })
}

/** Writes provider metadata to a segment row and the doc's turn accumulation. */
export async function saveSegmentMeta(
  ctx: MutationCtx,
  {
    row,
    messageId,
    rowMetadata,
    docMetadata,
  }: {
    row: Doc<'messageContents'>
    messageId: Id<'messages'>
    rowMetadata: Doc<'messages'>['metadata']
    docMetadata: Doc<'messages'>['metadata']
  },
) {
  await ctx.db.patch(row._id, { metadata: rowMetadata })
  await ctx.db.patch(messageId, { metadata: docMetadata })
}

/** Collapses the selected version to a single segment-0 row (message edit). */
export async function replaceSelectedContent(
  ctx: MutationCtx,
  message: Doc<'messages'>,
  parts: unknown[],
) {
  const segments = await listSelectedSegments(ctx, message)
  const head = segments[0]
  if (!head) error('Version not found', 404)

  await ctx.db.patch(head._id, {
    segmentIndex: 0,
    parts,
    searchText: searchTextFromParts(parts),
  })
  for (const row of segments.slice(1)) {
    await ctx.db.delete(row._id)
  }

  await ctx.db.patch(message._id, {
    contextEligible: isContextEligible(parts),
  })
}

/** Replaces one segment's parts, re-deriving the doc's eligibility. */
export async function setSegmentParts(
  ctx: MutationCtx,
  message: Doc<'messages'>,
  row: Doc<'messageContents'>,
  parts: unknown[],
) {
  await ctx.db.patch(row._id, {
    parts,
    searchText: searchTextFromParts(parts),
  })

  if (row.version !== message.selectedVersion) return
  const segments = await listSelectedSegments(ctx, message)
  await ctx.db.patch(message._id, {
    contextEligible: segments.some((segment) => segment.parts.length > 0),
  })
}

/** Points the message at another version and updates the denormalized fields. */
export async function setSelectedVersion(
  ctx: MutationCtx,
  message: Doc<'messages'>,
  version: number,
) {
  const segments = await listSegments(ctx, message._id, version)
  const head = segments[0]
  if (!head) error('Version not found', 404)

  await ctx.db.patch(message._id, {
    selectedVersion: version,
    contextEligible: segments.some((segment) => segment.parts.length > 0),
    metadata: mergeSegmentMetadata(segments),
    senderSnapshot: head.senderSnapshot ?? message.senderSnapshot,
  })
}

/** Deletes every content row of a message, releasing its tool-output blobs. */
export async function deleteVersions(
  ctx: MutationCtx,
  messageId: Id<'messages'>,
) {
  const rows = await listAllRows(ctx, messageId)
  for (const row of rows) {
    for (const storageId of collectToolOutputStorageIds(row.parts)) {
      await ctx.storage.delete(storageId).catch(() => {})
    }
    await ctx.db.delete(row._id)
  }
}

/** Merges segment metadata into a whole turn metadata. */
export function mergeSegmentMetadata(
  rows: { metadata?: Doc<'messages'>['metadata'] }[],
): Doc<'messages'>['metadata'] {
  let duration: number | undefined
  let toolErrors: string[] | undefined
  let warnings: string[] | undefined
  let usage: unknown
  let errorMessage: string | undefined

  for (const { metadata } of rows) {
    if (!metadata) continue
    if (metadata.duration !== undefined) {
      duration = (duration ?? 0) + metadata.duration
    }
    if (metadata.toolErrors?.length) {
      toolErrors = [...new Set([...(toolErrors ?? []), ...metadata.toolErrors])]
    }
    if (metadata.warnings?.length) {
      warnings = [...new Set([...(warnings ?? []), ...metadata.warnings])]
    }
    if (metadata.usage !== undefined) usage = metadata.usage
    if (metadata.error !== undefined) errorMessage = metadata.error
  }

  const merged = { duration, toolErrors, warnings, usage, error: errorMessage }
  return Object.values(merged).some((value) => value !== undefined)
    ? merged
    : undefined
}
