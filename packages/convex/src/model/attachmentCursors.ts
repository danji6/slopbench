import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AttachmentCursorCall, SaveAttachmentCursorArgs } from '../types'
import { getMember, requireEnabled } from './session/memberships'
import { ownsExecution } from './stream/execution'

const IDLE_TTL = 24 * 60 * 60 * 1000
const PRUNE_BATCH = 128

type CursorScope = Pick<
  Doc<'attachmentCursors'>,
  'sessionId' | 'agentId' | 'userId'
>

async function getReader(ctx: QueryCtx, call: AttachmentCursorCall) {
  const stream = await ctx.db.get(call.streamId)
  if (!ownsExecution(stream, call))
    error('Attachment read execution changed. Retry the tool call.', 409)

  const member = await getMember(ctx, stream.sessionId, stream.invokedBy)
  if (!member) error('Attachment operation is unavailable', 404)
  requireEnabled(member.session)

  const scope = {
    sessionId: stream.sessionId,
    agentId: stream.agentId,
    userId: stream.invokedBy,
  }
  return { scope, messageId: stream.state.processingMessageId }
}

function inScope(row: CursorScope, scope: CursorScope) {
  return (
    row.sessionId === scope.sessionId &&
    row.agentId === scope.agentId &&
    row.userId === scope.userId
  )
}

async function getCursor(ctx: QueryCtx, operationId: string) {
  return ctx.db
    .query('attachmentCursors')
    .withIndex('by_operationId', (q) => q.eq('operationId', operationId))
    .unique()
}

async function requireCursor(
  ctx: QueryCtx,
  scope: CursorScope,
  operationId: string,
) {
  const row = await getCursor(ctx, operationId)
  if (!row || row.expiresAt <= Date.now() || !inScope(row, scope))
    error(
      'Attachment operation is unavailable or expired. Start a new read or search.',
      404,
    )
  return row
}

async function getReceipt(
  ctx: QueryCtx,
  reader: Awaited<ReturnType<typeof getReader>>,
  call: AttachmentCursorCall,
) {
  const receipt = await ctx.db
    .query('attachmentCursorReceipts')
    .withIndex('by_call', (q) =>
      q.eq('messageId', reader.messageId).eq('callId', call.callId),
    )
    .unique()
  if (!receipt) return null
  if (receipt.expiresAt <= Date.now())
    error('Attachment tool call expired. Start a new read or search.', 404)
  if (!inScope(receipt, reader.scope) || receipt.request !== call.request)
    error('Attachment tool call arguments changed. Start a new call.', 409)
  return receipt
}

export async function read(ctx: QueryCtx, call: AttachmentCursorCall) {
  const reader = await getReader(ctx, call)
  const receipt = await getReceipt(ctx, reader, call)
  const operationId = receipt?.operationId ?? call.operationId
  if (!operationId) return null

  const cursor = await requireCursor(ctx, reader.scope, operationId)
  return { cursor, page: receipt?.page }
}

export async function save(ctx: MutationCtx, args: SaveAttachmentCursorArgs) {
  const reader = await getReader(ctx, args)
  const receipt = await getReceipt(ctx, reader, args)
  if (receipt) {
    const cursor = await requireCursor(ctx, reader.scope, receipt.operationId)
    await requireFile(ctx, cursor)
    return receipt.page
  }

  const expiresAt = Date.now() + IDLE_TTL
  const operationId = await updateCursor(ctx, reader.scope, args, expiresAt)
  await ctx.db.insert('attachmentCursorReceipts', {
    ...reader.scope,
    messageId: reader.messageId,
    callId: args.callId,
    request: args.request,
    operationId,
    page: args.page,
    expiresAt,
  })
  return args.page
}

async function updateCursor(
  ctx: MutationCtx,
  scope: CursorScope,
  args: SaveAttachmentCursorArgs,
  expiresAt: number,
) {
  if ('settings' in args.update) {
    const { operationId, settings } = args.update
    if (await getCursor(ctx, operationId))
      error('Attachment operation ID already exists. Retry the tool call.', 409)
    await requireFile(ctx, settings)
    await ctx.db.insert('attachmentCursors', {
      ...scope,
      ...settings,
      ...args.next,
      operationId,
      revision: 0,
      expiresAt,
    })
    return operationId
  }

  if (!args.operationId) error('Attachment operation ID is required', 400)
  const cursor = await requireCursor(ctx, scope, args.operationId)
  if (cursor.revision !== args.update.revision)
    error(
      'Attachment operation advanced in another call. Retry to get the next page.',
      409,
    )
  await requireFile(ctx, cursor)
  await ctx.db.patch(cursor._id, {
    ...args.next,
    expiresAt,
    revision: cursor.revision + 1,
  })
  return cursor.operationId
}

async function requireFile(
  ctx: QueryCtx,
  settings: Pick<Doc<'attachmentCursors'>, 'fileId' | 'storageId'>,
) {
  const file = await ctx.db.get(settings.fileId)
  if (!file || file.storageId !== settings.storageId)
    error('Attachment link is invalid or expired', 404)
}

export async function prune(ctx: MutationCtx) {
  const now = Date.now()
  const cursors = await ctx.db
    .query('attachmentCursors')
    .withIndex('by_expiresAt', (q) => q.lte('expiresAt', now))
    .take(PRUNE_BATCH)
  const receipts = await ctx.db
    .query('attachmentCursorReceipts')
    .withIndex('by_expiresAt', (q) => q.lte('expiresAt', now))
    .take(PRUNE_BATCH)
  for (const row of [...cursors, ...receipts]) await ctx.db.delete(row._id)
  if (cursors.length === PRUNE_BATCH || receipts.length === PRUNE_BATCH)
    await ctx.scheduler.runAfter(0, internal.attachments._pruneCursors, {})
}
