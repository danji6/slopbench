import type { McpProtocolMethod } from '@sb/core/types/mcp-protocol'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'
import type { StreamExecutionArgs } from '../../types'
import {
  operationOutput,
  settle,
  waitForOperation,
} from '../mcpOperationActions'
import type { RuntimeAuthorization } from './mcp'

export type McpOperationContext = {
  omitMedia?: boolean
  canReadOutput?: boolean
  ctx: ActionCtx
  execution: StreamExecutionArgs
  messageId: Id<'messages'>
  catalogToolId?: Id<'mcpCatalogTools'>
  broker?: {
    tool: string
    arguments: unknown
  }
}

type Invocation = {
  runtime: RuntimeAuthorization
  bootId: string
  generation: string
  protocolMethod?: McpProtocolMethod
  serverKey: string
  toolName: string
  name: string
  args: unknown
  toolCallId: string
  signal?: AbortSignal
}

/** Persists call identity before sidecar dispatch, then watches without owning execution. */
export async function executeMcpOperation(
  context: McpOperationContext,
  input: Invocation,
) {
  const { ctx, execution } = context
  const operation = await ctx.runMutation(internal.mcpOperations._reserve, {
    ...execution,
    messageId: context.messageId,
    runtimeId: input.runtime.runtimeId,
    key: input.runtime.scope.key,
    bootId: input.bootId,
    connectionGeneration: input.generation,
    serverKey: input.serverKey,
    toolName: input.toolName,
    protocolMethod: input.protocolMethod,
    name: input.name,
    toolCallId: input.toolCallId,
    args: JSON.stringify(input.args),
    input: context.broker ? JSON.stringify(context.broker) : undefined,
    catalogToolId: context.catalogToolId,
  })
  return finishOperation(context, operation, input.signal)
}

type ExistingInvocation = {
  protocolMethod?: McpProtocolMethod
  serverKey: string
  toolName: string
  name: string
  args: unknown
  toolCallId: string
  signal?: AbortSignal
}

/** Attaches to pending calls or serves completed results without reconnecting. */
export async function existingMcpOperation(
  context: McpOperationContext,
  input: ExistingInvocation,
) {
  const operation = await findMcpOperation(context, input)
  return operation
    ? { output: await finishOperation(context, operation, input.signal) }
    : null
}

/** Existing reservations already passed approval for these exact arguments. */
export function findMcpOperation(
  context: McpOperationContext,
  input: ExistingInvocation,
) {
  return context.ctx.runQuery(internal.mcpOperations._find, {
    ...context.execution,
    messageId: context.messageId,
    serverKey: input.serverKey,
    toolName: input.toolName,
    protocolMethod: input.protocolMethod,
    name: input.name,
    toolCallId: input.toolCallId,
    args: JSON.stringify(input.args),
    input: context.broker ? JSON.stringify(context.broker) : undefined,
    catalogToolId: context.catalogToolId,
  })
}

async function finishOperation(
  context: McpOperationContext,
  operation: Doc<'mcpOperations'>,
  signal?: AbortSignal,
) {
  const { ctx, execution } = context
  const result = await waitForOperation(ctx, execution, operation._id, {
    signal,
  })
  if (!result) {
    throw new Error('MCP watcher detached; operation remains pending')
  }
  await ctx.runMutation(internal.mcpOperations._deliver, {
    ...execution,
    operationId: result._id,
  })
  await settle(ctx, { operationId: result._id }).catch(() => {})
  if (result.error) throw new ToolError(result.error)
  return operationOutput(ctx, result)
}
