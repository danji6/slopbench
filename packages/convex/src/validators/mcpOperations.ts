import { MCP_OPERATION_STATES } from '@sb/core/types/mcp-operation'
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
  name: v.string(),
  args: v.string(),
  input: v.optional(v.string()),
  catalogToolId: v.optional(v.id('mcpCatalogTools')),
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
