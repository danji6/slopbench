import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type {
  McpObserveArgs,
  McpOperationArgs,
  McpOperationExecutionArgs,
  StreamExecutionArgs,
} from '../types'
import { allowed, get, requireExecution } from './mcpOperationAccess'
import { operationPart } from './mcpOperationParts'
import { patchSegmentParts } from './messageContents'

export { allowed, get, find, outputDefinition } from './mcpOperationAccess'
export { reserve } from './mcpOperationReservations'

type Operation = Doc<'mcpOperations'>

export async function pending(ctx: QueryCtx, args: StreamExecutionArgs) {
  await requireExecution(ctx, args)
  return ctx.db
    .query('mcpOperations')
    .withIndex('by_streamId_delivered', (q) =>
      q.eq('streamId', args.streamId).eq('delivered', false),
    )
    .take(64)
}

/** Commits result identity and transcript together; stale watchers cannot overwrite revocation. */
export async function observe(ctx: MutationCtx, args: McpObserveArgs) {
  const operation = await get(ctx, args)
  if (operation.state !== 'running') {
    if (args.outputRef && args.outputRef !== operation.outputRef) {
      await ctx.storage.delete(args.outputRef)
    }
    return operation
  }

  if (args.state === 'completed') {
    const authorization = await allowed(ctx, args)
    if (authorization !== 'allowed') {
      if (args.outputRef) await ctx.storage.delete(args.outputRef)
      await cancelOne(
        ctx,
        operation,
        'MCP access revoked, late result discarded. Outcome may be unknown.',
      )
      return (await ctx.db.get(operation._id))!
    }
  }

  const { state, progress, error: reason, output, outputRef } = args
  await ctx.db.patch(operation._id, {
    state,
    progress,
    error: reason,
    output,
    outputRef,
    updatedAt: Date.now(),
  })
  const updated = (await ctx.db.get(operation._id))!
  await project(ctx, updated)

  return updated
}

export async function deliver(
  ctx: MutationCtx,
  args: McpOperationExecutionArgs,
) {
  const operation = await get(ctx, args)
  if (operation.state === 'running') return false
  await project(ctx, operation)
  await ctx.db.patch(operation._id, { delivered: true })
  return true
}

async function project(ctx: MutationCtx, operation: Operation) {
  const row = await ctx.db.get(operation.contentId)
  if (!row) return

  const parts = row.parts.map((part) => {
    if (
      (part as { toolCallId?: string })?.toolCallId !== operation.toolCallId
    ) {
      return part
    }
    return operationPart(operation, part)
  })

  await patchSegmentParts(ctx, row.messageId, row, parts)
}

export async function cancelForStream(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
  reason: string,
) {
  const rows = await ctx.db
    .query('mcpOperations')
    .withIndex('by_streamId_delivered', (q) =>
      q.eq('streamId', streamId).eq('delivered', false),
    )
    .collect()
  for (const row of rows)
    if (row.state === 'running') await cancelOne(ctx, row, reason)
}

export async function cancelForRuntime(
  ctx: MutationCtx,
  runtimeId: Id<'mcpRuntimes'>,
  reason: string,
) {
  const rows = await ctx.db
    .query('mcpOperations')
    .withIndex('by_runtimeId_state', (q) =>
      q.eq('runtimeId', runtimeId).eq('state', 'running'),
    )
    .collect()
  for (const row of rows) await cancelOne(ctx, row, reason)
}

export async function cancelOne(
  ctx: MutationCtx,
  row: Operation,
  reason: string,
) {
  if (row.state !== 'running') return
  await ctx.db.patch(row._id, {
    state: 'cancelled',
    error: `${reason} Cancellation does not imply rollback.`,
    updatedAt: Date.now(),
  })
  await project(ctx, (await ctx.db.get(row._id))!)
  await ctx.scheduler.runAfter(0, internal.actions.mcpOperations._settle, {
    operationId: row._id,
  })
}

export async function acknowledged(
  ctx: MutationCtx,
  { operationId }: McpOperationArgs,
) {
  const row = await ctx.db.get(operationId)
  if (!row || row.deleted) return
  if (row.state === 'running') return
  await ctx.db.patch(row._id, { acknowledged: true })
}

export async function inspect(
  ctx: QueryCtx,
  { operationId }: McpOperationArgs,
) {
  return ctx.db.get(operationId)
}

export async function unsettled(ctx: QueryCtx) {
  const states = [
    'completed',
    'failed',
    'cancelled',
    'timedOut',
    'lost',
  ] as const

  const rows = await Promise.all(
    states.map((state) =>
      ctx.db
        .query('mcpOperations')
        .withIndex('by_state_acknowledged', (q) =>
          q.eq('state', state).eq('acknowledged', false),
        )
        .take(64),
    ),
  )

  return rows.flat()
}

/** Defers journal removal until cancellation and stale dispatch requests have settled. */
export async function removeForMessage(
  ctx: MutationCtx,
  messageId: Id<'messages'>,
) {
  const rows = await ctx.db
    .query('mcpOperations')
    .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
    .collect()

  for (const row of rows) {
    await cancelOne(ctx, row, 'Owning message deleted.')
    if (row.outputRef) await ctx.storage.delete(row.outputRef).catch(() => {})
    await ctx.db.patch(row._id, {
      deleted: true,
      acknowledged: false,
      outputRef: undefined,
      output: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.actions.mcpOperations._settle, {
      operationId: row._id,
    })
  }
}

export async function forgetDeleted(
  ctx: MutationCtx,
  { operationId }: McpOperationArgs,
) {
  const row = await ctx.db.get(operationId)
  if (row?.deleted) await ctx.db.delete(row._id)
}

/** Issues a short dispatch lease from the authorization snapshot, never from watcher time. */
export async function lease(ctx: QueryCtx, args: McpOperationExecutionArgs) {
  return {
    authorization: await allowed(ctx, args),
    expiresAt: Date.now() + 30_000,
  }
}
