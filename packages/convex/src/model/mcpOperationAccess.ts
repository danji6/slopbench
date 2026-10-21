import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { error } from '../errors'
import { sharedSessionId } from '../lib/subagent'
import type {
  McpOperationExecutionArgs,
  McpOperationFindArgs,
  StreamExecutionArgs,
} from '../types'
import { resolve } from './mcp'
import { isAuthorized } from './mcpRuntime'
import { isMcpToolSelected } from './mcpToolPolicy'
import { getProcessingSegmentRow } from './messageContents'
import { getMode } from './session/sessions'
import { ownsExecution } from './stream/execution'

export async function requireExecution(
  ctx: QueryCtx,
  args: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) {
    error('MCP execution no longer owns this turn', 409)
  }
  return stream
}

/** Resumption is generation-fenced, but retains the original operation identity. */
export async function get(ctx: QueryCtx, args: McpOperationExecutionArgs) {
  const stream = await requireExecution(ctx, args)
  const operation = await ctx.db.get(args.operationId)
  if (!operation || operation.streamId !== stream._id) {
    error('MCP operation unavailable', 404)
  }
  return operation
}

/** Checks the exact target policy as well as connection authority while waiting. */
export async function allowed(ctx: QueryCtx, args: McpOperationExecutionArgs) {
  const operation = await get(ctx, args)
  return allowedTarget(ctx, operation)
}

export async function allowedTarget(
  ctx: QueryCtx,
  operation: Doc<'mcpOperations'>,
) {
  if (operation.state !== 'running') return 'allowed' as const

  const runtime = await ctx.db.get(operation.runtimeId)
  if (!runtime || runtime.key !== operation.scope.key) return 'revoked' as const
  if (runtime.state === 'disconnected') return 'revoked' as const
  if (!(await isAuthorized(ctx, runtime))) return 'revoked' as const
  if (runtime.state === 'lost') return 'lost' as const

  const server = (await resolve(ctx, operation.ownerId)).find(
    (server) => server.id === operation.scope.serverId,
  )
  const tool = server?.tools?.find((tool) => tool.name === operation.toolName)
  if (!server || !tool) return 'revoked' as const

  const agent = await ctx.db.get(operation.agentId)
  if (!agent || !isMcpToolSelected(agent, server, tool))
    return 'revoked' as const

  if (operation.catalogToolId) {
    const target = await ctx.db.get(operation.catalogToolId)
    if (!target || target.catalogId !== server.catalogId)
      return 'revoked' as const
  }

  const session = await ctx.db.get(operation.sessionId)
  if (!session) return 'revoked' as const

  const readOnly = (await getMode(ctx, sharedSessionId(session))) === 'plan'
  return readOnly && tool.allowInReadOnly === false
    ? ('revoked' as const)
    : ('allowed' as const)
}

/** Reads an existing outcome before attempting any toolkit connection. */
export async function find(ctx: QueryCtx, args: McpOperationFindArgs) {
  const stream = await requireExecution(ctx, args)
  const content = await getProcessingSegmentRow(ctx, stream)
  if (!content || content.messageId !== args.messageId) {
    error('MCP output message changed', 409)
  }

  const row = await ctx.db
    .query('mcpOperations')
    .withIndex('by_contentId_toolCallId', (q) =>
      q.eq('contentId', content._id).eq('toolCallId', args.toolCallId),
    )
    .unique()
  if (row) assertSameInvocation(row, args)

  return row
}

export function assertSameInvocation(
  operation: Doc<'mcpOperations'>,
  args: McpOperationFindArgs,
) {
  if (operation.streamId !== args.streamId) {
    error('MCP invocation belongs to a different stream', 409)
  }
  const sameArguments =
    operation.args === args.args &&
    operation.input === args.input &&
    operation.catalogToolId === args.catalogToolId &&
    operation.toolName === args.toolName &&
    operation.name === args.name
  if (!sameArguments) {
    error('MCP operation identity reused with changed arguments', 409)
  }
  if (operation.scope.serverId !== args.serverKey) {
    error('MCP operation target changed', 409)
  }
}
