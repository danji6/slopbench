import { MCP_OPERATION_STATES } from '@sb/core/types/mcp-operation'
import { MCP_PROTOCOL_METHODS } from '@sb/core/types/mcp-protocol'
import { v } from 'convex/values'

import { mcpScopeValidator } from './mcp'
import { streamExecutionArgsValidator } from './streams'

export const mcpProgressValidator = v.object({
  progress: v.number(),
  total: v.optional(v.number()),
  message: v.optional(v.string()),
})

export const mcpOperationStateValidator = v.union(
  ...MCP_OPERATION_STATES.map((state) => v.literal(state)),
)

const protocolMethodValidator = v.union(
  ...MCP_PROTOCOL_METHODS.map((method) => v.literal(method)),
)

export const mcpOperationSchema = v.object({
  deleted: v.optional(v.boolean()),
  ownerId: v.id('users'),
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  contentId: v.id('messageContents'),
  toolCallId: v.string(),
  toolName: v.string(),
  protocolMethod: v.optional(protocolMethodValidator),
  name: v.string(),
  args: v.string(),
  input: v.optional(v.string()),
  catalogToolId: v.optional(v.id('mcpCatalogTools')),
  display: v.optional(
    v.object({ server: v.string(), name: v.string(), output: v.string() }),
  ),
  runtimeId: v.id('mcpRuntimes'),
  scope: mcpScopeValidator,
  bootId: v.string(),
  generation: v.string(),
  requestTimeoutMs: v.number(),
  maxTotalTimeoutMs: v.number(),
  state: mcpOperationStateValidator,
  progress: v.optional(mcpProgressValidator),
  error: v.optional(v.string()),
  output: v.optional(v.string()),
  outputRef: v.optional(v.id('_storage')),
  delivered: v.boolean(),
  acknowledged: v.boolean(),
  updatedAt: v.number(),
})

export const mcpOperationArgsValidator = v.object({
  operationId: v.id('mcpOperations'),
})

export const mcpOperationFindValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  messageId: v.id('messages'),
  serverKey: v.string(),
  toolName: v.string(),
  protocolMethod: v.optional(protocolMethodValidator),
  name: v.string(),
  toolCallId: v.string(),
  args: v.string(),
  input: v.optional(v.string()),
  catalogToolId: v.optional(v.id('mcpCatalogTools')),
})

export const mcpReserveArgsValidator = v.object({
  ...mcpOperationFindValidator.fields,
  runtimeId: v.id('mcpRuntimes'),
  key: v.string(),
  bootId: v.string(),
  connectionGeneration: v.string(),
})

export const mcpObserveArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  ...mcpOperationArgsValidator.fields,
  state: mcpOperationStateValidator,
  progress: v.optional(mcpProgressValidator),
  error: v.optional(v.string()),
  output: v.optional(v.string()),
  outputRef: v.optional(v.id('_storage')),
})

export const mcpOperationExecutionValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  ...mcpOperationArgsValidator.fields,
})
