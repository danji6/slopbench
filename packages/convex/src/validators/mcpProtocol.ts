import { MCP_PROTOCOL_METHODS } from '@sb/core/types/mcp-protocol'
import { v } from 'convex/values'

export const protocolRequestValidator = v.object({
  serverId: v.id('mcpServers'),
  method: v.union(...MCP_PROTOCOL_METHODS.map((method) => v.literal(method))),
  name: v.optional(v.string()),
  arguments: v.optional(v.record(v.string(), v.string())),
  uri: v.optional(v.string()),
})

export const protocolCheckSchema = v.object({
  ownerId: v.id('users'),
  serverId: v.id('mcpServers'),
  revision: v.number(),
  resultRef: v.id('_storage'),
  bytes: v.number(),
  expiresAt: v.number(),
})

export const protocolPublishValidator = v.object({
  serverId: v.id('mcpServers'),
  revision: v.number(),
  resultRef: v.id('_storage'),
  bytes: v.number(),
})

export const protocolCheckValidator = v.object({
  checkId: v.id('mcpProtocolChecks'),
})
