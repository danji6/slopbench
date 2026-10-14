import { MCP_TRANSPORTS } from '@sb/core/types'
import { v } from 'convex/values'

export const mcpTransportValidator = v.union(
  ...MCP_TRANSPORTS.map((id) => v.literal(id)),
)

export const mcpToolMetaValidator = v.object({
  name: v.string(),
  allowInReadOnly: v.optional(v.boolean()),
  nameOverride: v.optional(v.string()),
  description: v.optional(v.string()),
  descriptionOverride: v.optional(v.string()),
  inputSchema: v.optional(v.string()),
})

/** An MCP server joined with its tools and credential. */
export const mcpServerValidator = v.object({
  id: v.string(),
  label: v.string(),
  url: v.string(),
  transport: mcpTransportValidator,
  apiKey: v.optional(v.string()),
  enabled: v.boolean(),
  tools: v.optional(v.array(mcpToolMetaValidator)),
})

/** Cached metadata for one external MCP tool. */
export const mcpManifestEntryValidator = v.object({
  name: v.string(),
  serverId: v.string(),
  toolName: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.optional(v.string()),
})

export const replaceMcpServersArgsValidator = v.object({
  servers: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      url: v.string(),
      transport: mcpTransportValidator,
      enabled: v.boolean(),
      /** Absent leaves the stored credential alone; empty clears it. */
      apiKey: v.optional(v.string()),
      /** Absent keeps the tools already discovered for this server. */
      tools: v.optional(v.array(mcpToolMetaValidator)),
    }),
  ),
})

export const mcpExecutionArgsValidator = v.object({
  agentId: v.id('agents'),
  sessionId: v.id('sessions'),
  serverKey: v.string(),
})

export const discoverMcpToolsArgsValidator = v.object({
  url: v.string(),
  transport: mcpTransportValidator,
  apiKey: v.optional(v.string()),
  serverId: v.optional(v.id('mcpServers')),
})

/** An external MCP server, without its credential or discovered tools. */
export const mcpServerSchema = v.object({
  ownerId: v.id('users'),
  /** Client-generated key, stable across renames. */
  key: v.string(),
  label: v.string(),
  url: v.string(),
  transport: mcpTransportValidator,
  enabled: v.boolean(),
  order: v.number(),
})

/** One tool discovered from an external MCP server. */
export const mcpToolSchema = v.object({
  serverId: v.id('mcpServers'),
  name: v.string(),
  allowInReadOnly: v.optional(v.boolean()),
  nameOverride: v.optional(v.string()),
  description: v.optional(v.string()),
  descriptionOverride: v.optional(v.string()),
  /** The tool's JSON schema, kept as a string to avoid Convex rejections. */
  inputSchema: v.optional(v.string()),
  order: v.number(),
})
