import { attachmentRef } from '@cv/core/attachments'
import { transitionActive } from '@cv/core/workspace/transition'
import type { Infer } from 'convex/values'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import { sharedSessionId } from '../lib/subagent'
import type { StreamExecutionArgs } from '../types'
import type {
  attachmentTransferCall,
  attachmentTransferResult,
} from '../validators/attachmentTransfers'
import { createGeneratedAttachment } from './attachments'
import { getProcessingSegmentRow, patchSegmentParts } from './messageContents'
import { requireEnabled, requireMember } from './session/memberships'
import { ownsExecution } from './stream/execution'

type Call = Infer<typeof attachmentTransferCall>

export type TransferResult = Infer<typeof attachmentTransferResult>

type Operation = Doc<'attachmentTransfers'>

export function transferTarget(
  operation: Pick<Operation, '_id' | 'rootId' | 'path'>,
) {
  return {
    sessionId: operation.rootId,
    operationId: operation._id,
    path: operation.path,
  }
}

const TRANSFER_TTL = 30 * 60 * 1000

async function activeTransfer(
  ctx: QueryCtx,
  execution: StreamExecutionArgs,
  kind: Call['kind'],
) {
  const stream = await ctx.db.get(execution.streamId)
  if (!ownsExecution(stream, execution))
    error('Attachment transfer is no longer active', 409)

  const session = await ctx.db.get(stream.sessionId)
  const agent = await ctx.db.get(stream.agentId)
  if (!session || !agent?.tools?.includes('process_attachments'))
    error(`Tool is no longer enabled: ${kind}`, 403)

  const rootId = sharedSessionId(session)
  const { session: root } = await requireMember(ctx, rootId, stream.invokedBy)
  requireEnabled(root)
  requireEnabled({
    ...session,
    contextLock: transitionActive(session.contextLock)
      ? session.contextLock
      : undefined,
  })
  if (root.mode === 'plan' || session.mode === 'plan')
    error('Attachment processing is unavailable in plan mode', 409)

  const content = await getProcessingSegmentRow(ctx, stream)
  if (!content) error('Attachment transfer has no active response', 409)

  return { stream, rootId, content }
}

export async function begin(ctx: MutationCtx, call: Call) {
  const { stream, rootId, content } = await activeTransfer(ctx, call, call.kind)
  const previous = await ctx.db
    .query('attachmentTransfers')
    .withIndex('by_contentId_callId', (q) =>
      q.eq('contentId', content._id).eq('callId', call.callId),
    )
    .unique()

  if (previous) {
    if (previous.request !== call.request || previous.kind !== call.kind)
      error('Attachment transfer arguments changed', 409)
    if (
      !previous.result &&
      (previous.cleaned || previous.expiresAt <= Date.now())
    ) {
      error('Attachment transfer expired', 409)
    }
    if (!previous.result && previous.generation !== call.generation)
      await ctx.db.patch(previous._id, { generation: call.generation })
    return previous
  }

  const id = await ctx.db.insert('attachmentTransfers', {
    ...call,
    rootId,
    contentId: content._id,
    sessionId: stream.sessionId,
    expiresAt: Date.now() + TRANSFER_TTL,
  })

  return (await ctx.db.get(id))!
}

export async function requireActive(
  ctx: QueryCtx,
  id: Id<'attachmentTransfers'>,
  execution: StreamExecutionArgs,
) {
  const row = await ctx.db.get(id)

  const inactive =
    !row ||
    (!row.result && (row.cleaned || row.expiresAt <= Date.now())) ||
    row.streamId !== execution.streamId ||
    row.generation !== execution.generation
  if (inactive) error('Attachment transfer is no longer active', 409)

  const context = await activeTransfer(ctx, execution, row.kind)
  if (context.content._id !== row.contentId || context.rootId !== row.rootId)
    error('Attachment transfer response changed', 409)

  return { row, ...context }
}

export async function finishCopy(
  ctx: MutationCtx,
  id: Id<'attachmentTransfers'>,
  execution: StreamExecutionArgs,
  result: TransferResult,
) {
  const { row } = await requireActive(ctx, id, execution)
  if (row.result) return row.result
  await recordResult(ctx, row, result)
  return result
}

type Publish = {
  storageId: Id<'_storage'>
  filename: string
  mediaType: string
}

export async function finishPublish(
  ctx: MutationCtx,
  id: Id<'attachmentTransfers'>,
  execution: StreamExecutionArgs,
  file: Publish,
) {
  const { row, stream, content } = await requireActive(ctx, id, execution)
  if (row.result) return row.result

  const { attachmentId, metadata } = await createGeneratedAttachment(ctx, {
    ...file,
    ...execution,
    sessionId: stream.sessionId,
    messageId: stream.state.processingMessageId,
    uploaderId: stream.invokedBy,
  })
  const result = {
    attachmentId,
    reference: attachmentRef(metadata.shareToken, file.filename),
    filename: file.filename,
    mediaType: file.mediaType,
    byteLength: metadata.byteLength,
  }

  await recordResult(ctx, row, result)
  await patchSegmentParts(ctx, stream.state.processingMessageId, content, [
    ...content.parts,
    publishedPart(result),
  ])

  return result
}

async function recordResult(
  ctx: MutationCtx,
  row: Operation,
  result: TransferResult,
) {
  await ctx.db.patch(row._id, { result, expiresAt: Date.now() })
  await ctx.scheduler.runAfter(
    1_000,
    internal.actions.sessions._cleanAttachmentTransfer,
    { id: row._id },
  )
}

function publishedPart(result: TransferResult) {
  return {
    type: 'file',
    url: `attachment:${result.attachmentId}`,
    attachmentId: result.attachmentId,
    mediaType: result.mediaType,
    filename: result.filename,
    publishedByTool: true,
  }
}

/** Retains committed cards when a provider update arrives with an older parts array. */
export function mergePublishedAttachments(
  previous: unknown[],
  parts: unknown[],
) {
  const ids = new Set(parts.map(filePartId))
  return [
    ...parts,
    ...previous.filter((part) => {
      const file = part as { publishedByTool?: boolean }
      return file?.publishedByTool && !ids.has(filePartId(part))
    }),
  ]
}

function filePartId(part: unknown) {
  const file = part as { type?: string; attachmentId?: string }
  return file?.type === 'file' ? file.attachmentId : undefined
}

export async function discardUpload(
  ctx: MutationCtx,
  id: Id<'attachmentTransfers'>,
  storageId: Id<'_storage'>,
) {
  const row = await ctx.db.get(id)
  if (!row || row.cleaned) return
  if (!row.result) {
    const retained = await ctx.db
      .query('attachmentFiles')
      .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
      .first()
    const exists = await ctx.db.system.get('_storage', storageId)
    if (!retained && exists) await ctx.storage.delete(storageId)
  }
}

export async function markCleaned(
  ctx: MutationCtx,
  id: Id<'attachmentTransfers'>,
) {
  if (await ctx.db.get(id)) await ctx.db.patch(id, { cleaned: true })
}

export async function abandonTransfer(
  ctx: MutationCtx,
  id: Id<'attachmentTransfers'>,
  execution: StreamExecutionArgs,
) {
  const row = await ctx.db.get(id)
  if (
    row?.streamId !== execution.streamId ||
    row.generation !== execution.generation
  )
    return
  await expireTransfer(ctx, row)
}

async function expireTransfer(ctx: MutationCtx, row: Operation) {
  if (row.cleaned || row.result) return
  await ctx.db.patch(row._id, { expiresAt: Date.now() })
  await ctx.scheduler.runAfter(
    0,
    internal.actions.sessions._cleanAttachmentTransfer,
    { id: row._id },
  )
}

export async function expireStreamTransfers(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
) {
  const pending = await ctx.db
    .query('attachmentTransfers')
    .withIndex('by_streamId', (q) => q.eq('streamId', streamId))
    .collect()
  for (const row of pending) await expireTransfer(ctx, row)
}

export async function sweep(ctx: MutationCtx) {
  const rows = await ctx.db
    .query('attachmentTransfers')
    .withIndex('by_cleaned_expiresAt', (q) =>
      q.eq('cleaned', undefined).lte('expiresAt', Date.now()),
    )
    .take(100)
  for (const row of rows)
    await ctx.scheduler.runAfter(
      0,
      internal.actions.sessions._cleanAttachmentTransfer,
      { id: row._id },
    )

  const cleaned = await ctx.db
    .query('attachmentTransfers')
    .withIndex('by_cleaned_expiresAt', (q) =>
      q.eq('cleaned', true).lte('expiresAt', Date.now() - 24 * 60 * 60 * 1000),
    )
    .take(100)
  for (const row of cleaned) await ctx.db.delete(row._id)
}
