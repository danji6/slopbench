import { MCP_TRANSPORTS } from '@sb/core/types'
import { paginationOptsValidator } from 'convex/server'
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
  definitionRef: v.optional(v.string()),
  diagnostic: v.optional(v.string()),
  enabled: v.optional(v.boolean()),
})

export const mcpLaunchFields = {
  integrationBinding: v.optional(
    v.object({ root: v.string(), revision: v.string() }),
  ),
  command: v.optional(v.string()),
  args: v.optional(v.array(v.string())),
  cwd: v.optional(v.string()),
  env: v.optional(v.record(v.string(), v.string())),
  startupTimeoutMs: v.optional(v.number()),
  requestTimeoutMs: v.optional(v.number()),
  maxTotalTimeoutMs: v.optional(v.number()),
}

export const mcpScopeValidator = v.object({
  epoch: v.optional(v.number()),
  key: v.string(),
  ownerId: v.string(),
  sessionId: v.string(),
  agentId: v.string(),
  serverId: v.string(),
  revision: v.string(),
})

export const mcpRuntimeSchema = v.object({
  epoch: v.optional(v.number()),
  ownerId: v.id('users'),
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  invokedBy: v.id('users'),
  serverKey: v.string(),
  key: v.string(),
  revision: v.string(),
  workspaceKey: v.string(),
  state: v.string(),
  bootId: v.optional(v.string()),
  generation: v.optional(v.string()),
  initialization: v.optional(v.string()),
  reason: v.optional(v.string()),
  updatedAt: v.number(),
})

export const mcpCleanupSchema = v.object({ scope: mcpScopeValidator })

export const mcpRuntimeArgsValidator = v.object({
  runtimeId: v.id('mcpRuntimes'),
})

export const mcpCleanupArgsValidator = v.object({
  cleanupId: v.id('mcpCleanups'),
})

export const mcpRuntimeControlArgsValidator = v.object({
  ...mcpRuntimeArgsValidator.fields,
  reconnect: v.boolean(),
})

export const mcpRuntimeConnectedArgsValidator = v.object({
  ...mcpRuntimeArgsValidator.fields,
  key: v.string(),
  bootId: v.string(),
  generation: v.string(),
  initialization: v.optional(v.string()),
})

export const mcpRuntimeStatusArgsValidator = v.object({
  ...mcpRuntimeArgsValidator.fields,
  key: v.string(),
  state: v.string(),
  reason: v.optional(v.string()),
})

export const mcpRuntimeRetireArgsValidator = v.object({
  ...mcpRuntimeArgsValidator.fields,
  key: v.string(),
  reason: v.string(),
})

export const mcpRuntimeInspectArgsValidator = v.object({
  scope: mcpScopeValidator,
})

export const mcpRuntimeListArgsValidator = v.object({
  serverKey: v.string(),
  paginationOpts: paginationOptsValidator,
})

export const mcpRuntimePageArgsValidator = v.object({
  state: v.string(),
  paginationOpts: paginationOptsValidator,
})

/** An MCP server joined with its tools and credential. */
export const mcpServerValidator = v.object({
  integrationId: v.optional(v.string()),
  recordId: v.optional(v.string()),
  id: v.string(),
  label: v.string(),
  url: v.string(),
  ...mcpLaunchFields,
  transport: mcpTransportValidator,
  apiKey: v.optional(v.string()),
  secretEnv: v.optional(v.record(v.string(), v.string())),
  revision: v.optional(v.number()),
  enabled: v.boolean(),
  tools: v.optional(v.array(mcpToolMetaValidator)),
  catalogId: v.optional(v.string()),
  catalogCount: v.optional(v.number()),
  catalogError: v.optional(v.string()),
  brokerEnabled: v.optional(v.boolean()),
})

/** Cached metadata for one external MCP tool. */
export const mcpManifestEntryValidator = v.object({
  name: v.string(),
  serverId: v.string(),
  toolName: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.optional(v.string()),
  definitionRef: v.optional(v.string()),
  diagnostic: v.optional(v.string()),
})

export const replaceMcpServersArgsValidator = v.object({
  servers: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      url: v.string(),
      ...mcpLaunchFields,
      secretEnv: v.optional(v.record(v.string(), v.string())),
      transport: mcpTransportValidator,
      enabled: v.boolean(),
      brokerEnabled: v.optional(v.boolean()),
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
  toolName: v.optional(v.string()),
  streamId: v.optional(v.id('streams')),
  generation: v.optional(v.number()),
})

export const discoverMcpToolsArgsValidator = v.object({
  url: v.string(),
  ...mcpLaunchFields,
  transport: mcpTransportValidator,
  apiKey: v.optional(v.string()),
  serverId: v.optional(v.id('mcpServers')),
})

/** An external MCP server, without its credential or discovered tools. */
export const mcpServerSchema = v.object({
  integrationId: v.optional(v.id('integrations')),
  componentName: v.optional(v.string()),
  ownerId: v.id('users'),
  /** Client-generated key, stable across renames. */
  key: v.string(),
  label: v.string(),
  url: v.string(),
  ...mcpLaunchFields,
  transport: mcpTransportValidator,
  enabled: v.boolean(),
  revision: v.optional(v.number()),
  catalogId: v.optional(v.id('mcpCatalogs')),
  pendingCatalogId: v.optional(v.id('mcpCatalogs')),
  catalogRetryAt: v.optional(v.number()),
  catalogCount: v.optional(v.number()),
  catalogError: v.optional(v.string()),
  brokerEnabled: v.optional(v.boolean()),
  order: v.number(),
})

/** One tool discovered from an external MCP server. */
export const mcpToolSchema = v.object({
  ...mcpToolMetaValidator.fields,
  serverId: v.id('mcpServers'),
  order: v.number(),
})
