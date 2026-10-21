import { mcpOperationTimeouts } from '@sb/core/types/mcp-operation'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { error } from '../errors'
import type { McpReserveArgs, RunningStream } from '../types'
import { _getExecution } from './mcp'
import { assertSameInvocation, requireExecution } from './mcpOperationAccess'
import { operationPart } from './mcpOperationParts'
import { getProcessingSegmentRow, patchSegmentParts } from './messageContents'

type Authorization = NonNullable<Awaited<ReturnType<typeof _getExecution>>>

/** Reserves and checkpoints an invocation before any sidecar dispatch. */
export async function reserve(ctx: MutationCtx, args: McpReserveArgs) {
  const stream = await requireExecution(ctx, args)
  const row = await getProcessingSegmentRow(ctx, stream)
  if (!row || row.messageId !== args.messageId) {
    error('MCP output message changed', 409)
  }

  const previous = await ctx.db
    .query('mcpOperations')
    .withIndex('by_contentId_toolCallId', (q) =>
      q.eq('contentId', row._id).eq('toolCallId', args.toolCallId),
    )
    .unique()
  if (previous) {
    assertSameInvocation(previous, args)
    if (previous.scope.key !== args.key)
      error('MCP operation connection was replaced; previous outcome may be unknown', 409) // prettier-ignore
    return previous
  }

  const live = await authorize(ctx, stream, args)
  const id = await ctx.db.insert('mcpOperations', fields(stream, row._id, args, live)) // prettier-ignore
  const operation = (await ctx.db.get(id))!
  await checkpoint(ctx, row, operation)

  return operation
}

async function authorize(
  ctx: MutationCtx,
  stream: RunningStream,
  args: McpReserveArgs,
) {
  const waiting = await ctx.db
    .query('mcpOperations')
    .withIndex('by_streamId_delivered', (q) =>
      q.eq('streamId', stream._id).eq('delivered', false),
    )
    .take(64)
  if (waiting.length >= 64) {
    error('MCP pending-operation capacity reached for this turn', 409)
  }

  const live = await _getExecution(ctx, {
    ...args,
    agentId: stream.agentId,
    sessionId: stream.sessionId,
  })

  if (!live) {
    error('MCP execution revoked', 403)
  }
  if (live.runtime.runtimeId !== args.runtimeId) {
    error('MCP connection replaced', 409)
  }
  if (live.runtime.scope.key !== args.key) {
    error('MCP connection replaced', 409)
  }
  if (live.runtime.bootId !== args.bootId) {
    error('MCP connection generation changed', 409)
  }
  if (live.runtime.generation !== args.connectionGeneration) {
    error('MCP connection generation changed', 409)
  }

  const tool = live.server.tools?.find((tool) => tool.name === args.toolName)

  if (live.readOnly && tool?.allowInReadOnly === false) {
    error('This external tool is not allowed in read-only mode.', 403)
  }

  return live
}

function fields(
  stream: RunningStream,
  contentId: Id<'messageContents'>,
  args: McpReserveArgs,
  live: Authorization,
) {
  return {
    ownerId: live.runtime.scope.ownerId as Id<'users'>,
    sessionId: stream.sessionId,
    agentId: stream.agentId,
    streamId: stream._id,
    messageId: args.messageId,
    contentId,
    name: args.name,
    toolName: args.toolName,
    toolCallId: args.toolCallId,
    args: args.args,
    runtimeId: args.runtimeId,
    scope: live.runtime.scope,
    bootId: args.bootId,
    generation: args.connectionGeneration,
    ...mcpOperationTimeouts(live.server),
    state: 'running' as const,
    delivered: false,
    acknowledged: false,
    updatedAt: Date.now(),
  }
}

async function checkpoint(
  ctx: MutationCtx,
  row: Doc<'messageContents'>,
  operation: Doc<'mcpOperations'>,
) {
  const parts = [...row.parts]
  const index = parts.findIndex(
    (part) =>
      (part as { toolCallId?: string })?.toolCallId === operation.toolCallId,
  )
  if (index < 0) parts.push(operationPart(operation))
  else parts[index] = operationPart(operation, parts[index])
  await patchSegmentParts(ctx, row.messageId, row, parts)
}
