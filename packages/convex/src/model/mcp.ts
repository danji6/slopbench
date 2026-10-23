import { limitError } from '@sb/core/limit-errors'
import { MAX_MCP_SERVERS } from '@sb/core/limits'
import type { McpServer, McpToolMeta } from '@sb/core/types'
import { mcpConnectionSchema, validateMcpTools } from '@sb/core/types'
import { integrationWorkspaceSettings } from '@sb/core/types/integration'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import { minRole } from '../lib/roles'
import { sharedSessionId } from '../lib/subagent'
import type { McpExecutionArgs, McpServerInput } from '../types'
import * as Credentials from './credentials'
import { availableIntegrations } from './integrations/access'
import { catalogRows } from './mcpCatalogs'
import { launchFields, parseSecrets, saveCredentials } from './mcpConfiguration'
import { revokeRestrictedTargets } from './mcpPolicyRevocation'
import { authorizeRuntime, revoke } from './mcpRuntime'
import { isMcpServerSelected, isMcpToolSelected } from './mcpToolPolicy'
import { getSessionWithWorkspace } from './session/folderContext'
import { getMode } from './session/sessions'
import { ownsExecution } from './stream/execution'

/** Resolves live server configuration and mode immediately before execution. */
export async function _getExecution(
  ctx: MutationCtx,
  {
    agentId,
    sessionId,
    serverKey,
    toolName,
    streamId,
    generation,
  }: McpExecutionArgs,
) {
  const agent = await ctx.db.get(agentId)
  const session = await ctx.db.get(sessionId)
  if (!agent || !session) return null

  const servers = await resolve(ctx, agent.ownerId, {
    withCredentials: true,
    agentId,
    sessionId,
  })
  const server = servers.find(
    (candidate) => candidate.id === serverKey && candidate.enabled,
  )
  if (!server) return null

  const selectedTool = server.tools?.some(
    (meta) =>
      (!toolName || meta.name === toolName) &&
      isMcpToolSelected(agent, server, meta),
  )
  if (toolName ? !selectedTool : !isMcpServerSelected(agent, server))
    return null

  const stream = streamId ? await ctx.db.get(streamId) : null
  if (!stream) return null
  if (generation === undefined) return null
  if (!ownsExecution(stream, { streamId: streamId!, generation })) return null
  if (stream.sessionId !== sessionId || stream.agentId !== agentId) return null

  const invoker = await ctx.db.get(stream.invokedBy)
  if (!invoker) return null

  const localExecutionForbidden =
    server.transport === 'stdio' && !minRole(invoker.role, 'admin')
  if (localExecutionForbidden) return null

  const runtime = await authorizeRuntime(ctx, {
    ownerId: agent.ownerId,
    sessionId,
    agentId,
    invokedBy: invoker._id,
    serverKey,
    revision: server.revision ?? 0,
  })

  return {
    server,
    readOnly: (await getMode(ctx, sharedSessionId(session))) === 'plan',
    runtime,
  }
}

/** What the settings UI renders. */
export type McpServerView = Omit<McpServer, 'apiKey' | 'secretEnv'> & {
  secretEnvNames: string[]
  _id: Id<'mcpServers'>
  hasKey: boolean
}

export async function list(ctx: AuthQueryCtx): Promise<McpServerView[]> {
  const servers = (await listServers(ctx, ctx.userId)).filter(
    (server) => !server.integrationId,
  )
  const keys = await Credentials.map(ctx, ctx.userId, 'mcp')
  const secrets = await Credentials.map(ctx, ctx.userId, 'mcp-env')

  return Promise.all(
    servers.map(async (server) => ({
      _id: server._id,
      id: server.key,
      label: server.label,
      ...launchFields(server),
      transport: server.transport,
      enabled: server.enabled,
      catalogId: server.catalogId,
      catalogCount: server.catalogCount,
      catalogError: server.catalogError,
      brokerEnabled: server.brokerEnabled,
      tools: await listTools(ctx, server._id),
      hasKey: keys.has(server.key),
      secretEnvNames: Object.keys(parseSecrets(secrets.get(server.key))),
    })),
  )
}

type McpResolveOptions = {
  withCredentials?: boolean
  agentId?: Id<'agents'>
  sessionId?: Id<'sessions'>
}

/**
 * Servers joined with their tools. Only pass `withCredentials` if used
 * internally, never send them to the client.
 */
export async function resolve(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  { withCredentials = false, agentId, sessionId }: McpResolveOptions = {},
): Promise<McpServer[]> {
  const servers = await listServers(ctx, ownerId)
  const active = agentId
    ? await availableIntegrations(ctx, agentId, sessionId)
    : []
  const enabledIds = new Set(active.map((row) => row._id))
  const session = sessionId
    ? await getSessionWithWorkspace(ctx, sessionId)
    : null

  const keys = withCredentials
    ? await Credentials.map(ctx, ownerId, 'mcp')
    : new Map<string, string>()

  const secrets = withCredentials
    ? await Credentials.map(ctx, ownerId, 'mcp-env')
    : new Map<string, string>()

  return Promise.all(
    servers.map(async (server) => {
      let launch = launchFields(server)
      let enabled = server.enabled
      if (server.integrationId) {
        enabled &&= enabledIds.has(server.integrationId)
        try {
          launch = integrationWorkspaceSettings(
            launch,
            session?.workspace?.path,
          )
        } catch {
          enabled = false
        }
      }
      return {
        integrationId: server.integrationId,
        recordId: server._id,
        id: server.key,
        label: server.label,
        ...launch,
        transport: server.transport,
        enabled,
        catalogId: await currentCatalogId(ctx, server),
        catalogCount: server.catalogCount,
        catalogError: server.catalogError,
        brokerEnabled: server.brokerEnabled,
        apiKey: keys.get(server.key),
        secretEnv: parseSecrets(secrets.get(server.key)),
        revision: server.revision,
        tools: await resolvedTools(ctx, server),
      }
    }),
  )
}

/**
 * Replaces the whole server list from the settings form. Already discovered
 * ones keep their tools.
 */
export async function replaceAll(
  ctx: AuthMutationCtx,
  { servers }: { servers: McpServerInput[] },
) {
  if (servers.length > MAX_MCP_SERVERS) {
    error(limitError('mcpServers'), 400)
  }

  const stored = await listServers(ctx, ctx.userId)
  const integrationKeys = new Set(
    stored.filter((row) => row.integrationId).map((row) => row.key),
  )
  if (servers.length + integrationKeys.size > MAX_MCP_SERVERS)
    error(limitError('mcpServers'), 400)

  const existing = stored.filter((server) => !server.integrationId)
  const byKey = new Map(existing.map((server) => [server.key, server]))
  const seen = new Set<string>()

  for (const [order, input] of servers.entries()) {
    if (integrationKeys.has(input.key))
      error('Integration servers use Integrations settings', 400)
    if (seen.has(input.key)) continue
    seen.add(input.key)
    await saveServer(ctx, input, byKey.get(input.key), order)
  }

  for (const server of existing) {
    if (seen.has(server.key)) continue
    await removeServer(ctx, server)
  }
}

async function saveServer(
  ctx: AuthMutationCtx,
  input: McpServerInput,
  server: Doc<'mcpServers'> | undefined,
  order: number,
) {
  const { apiKey, secretEnv, tools, ...fields } = input
  const parsed = mcpConnectionSchema.safeParse({ ...fields, secretEnv })
  if (!parsed.success) {
    error(parsed.error.issues[0]?.message ?? 'Invalid MCP connection', 400)
  }

  const localChange = fields.transport === 'stdio' || server?.transport === 'stdio' // prettier-ignore
  const changed = connectionChanged(server, input)
  const toolsChanged =
    tools !== undefined &&
    server &&
    !sameTools(await toolRows(ctx, server._id), validateMcpTools(tools))
  const localConfigurationChanged = localChange && (changed || toolsChanged)
  if (localConfigurationChanged && !minRole(ctx.role, 'admin')) {
    error('Local MCP configuration requires admin access', 403)
  }
  if (server && changed) {
    await revoke(
      ctx,
      { ownerId: ctx.userId, serverKey: server.key },
      'MCP configuration changed',
    )
  }

  const revision = (server?.revision ?? 0) + (changed ? 1 : 0)
  let serverId: Id<'mcpServers'>
  if (server) {
    serverId = server._id
    await ctx.db.patch(serverId, {
      ...fields,
      ...launchFields(fields),
      revision,
      order,
    })
  } else {
    serverId = await ctx.db.insert('mcpServers', {
      ownerId: ctx.userId,
      ...fields,
      revision,
      order,
    })
  }

  await saveCredentials(ctx, fields.key, apiKey, secretEnv)
  if (tools) await writeTools(ctx, serverId, tools)
  if (
    server &&
    (toolsChanged || server.brokerEnabled !== fields.brokerEnabled)
  ) {
    await revokeRestrictedTargets(ctx, ctx.userId, server.key)
  }
}

/** Compares connection authority separately from presentation-only tool metadata. */
function connectionChanged(
  server: Doc<'mcpServers'> | undefined,
  input: McpServerInput,
): boolean {
  if (!server) return true
  const previous = { transport: server.transport, ...launchFields(server) }
  const next = { transport: input.transport, ...launchFields(input) }
  return (
    JSON.stringify(previous) !== JSON.stringify(next) ||
    server.enabled !== input.enabled ||
    server.label !== input.label ||
    input.apiKey !== undefined ||
    input.secretEnv !== undefined
  )
}

export async function removeServer(
  ctx: AuthMutationCtx,
  server: Doc<'mcpServers'>,
) {
  if (server.transport === 'stdio' && !minRole(ctx.role, 'admin')) {
    error('Local MCP configuration requires admin access', 403)
  }
  await revoke(
    ctx,
    { ownerId: ctx.userId, serverKey: server.key },
    'MCP server removed',
  )
  await Credentials.remove(ctx, ctx.userId, 'mcp-env', server.key)
  for (const tool of await toolRows(ctx, server._id)) {
    await ctx.db.delete(tool._id)
  }
  await Credentials.remove(ctx, ctx.userId, 'mcp', server.key)
  if (server.catalogId) {
    await ctx.scheduler.runAfter(0, internal.actions.mcpCatalogs._expire, {
      catalogId: server.catalogId,
    })
  }
  await ctx.db.delete(server._id)
}

/** Replaces a server's tool set. */
export async function writeTools(
  ctx: AuthMutationCtx,
  serverId: Id<'mcpServers'>,
  tools: McpToolMeta[],
) {
  const next = validateMcpTools(tools).map(
    ({ definitionRef: _, ...tool }) => tool,
  )
  const existing = await toolRows(ctx, serverId)
  if (sameTools(existing, next)) return

  for (const row of existing) await ctx.db.delete(row._id)
  for (const [order, tool] of next.entries()) {
    await ctx.db.insert('mcpTools', { serverId, ...tool, order })
  }
}

function sameTools(existing: Doc<'mcpTools'>[], next: McpToolMeta[]): boolean {
  return (
    existing.length === next.length &&
    existing.every(
      (row, index) =>
        row.name === next[index].name &&
        row.allowInReadOnly === next[index].allowInReadOnly &&
        row.nameOverride === next[index].nameOverride &&
        row.description === next[index].description &&
        row.descriptionOverride === next[index].descriptionOverride &&
        row.inputSchema === next[index].inputSchema &&
        row.enabled === next[index].enabled &&
        row.diagnostic === next[index].diagnostic &&
        row.definitionRef === next[index].definitionRef,
    )
  )
}

/** The server row, for ownership check. */
export async function get(
  ctx: AuthQueryCtx,
  { serverId }: { serverId: Id<'mcpServers'> },
) {
  const server = await ctx.db.get(serverId)
  if (!server) error('Not found', 404)
  if (server.ownerId !== ctx.userId) error('Not found', 404)
  return { _id: server._id, url: server.url, transport: server.transport }
}

function listServers(ctx: QueryCtx | MutationCtx, ownerId: Id<'users'>) {
  return ctx.db
    .query('mcpServers')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', ownerId))
    .order('asc')
    .collect()
}

function toolRows(ctx: QueryCtx | MutationCtx, serverId: Id<'mcpServers'>) {
  return ctx.db
    .query('mcpTools')
    .withIndex('by_serverId_order', (q) => q.eq('serverId', serverId))
    .order('asc')
    .collect()
}

export async function listTools(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<'mcpServers'>,
): Promise<McpToolMeta[]> {
  const rows = await toolRows(ctx, serverId)
  return rows.map(
    ({ _id: _, _creationTime: __, serverId: ___, order: ____, ...tool }) =>
      tool,
  )
}

/** Keeps schemas out of reactive stream state while preserving exact definition references. */
async function resolvedTools(
  ctx: QueryCtx,
  server: Doc<'mcpServers'>,
): Promise<McpToolMeta[]> {
  const overrides = await listTools(ctx, server._id)
  if (!server.catalogId) return overrides

  const catalog = await ctx.db.get(server.catalogId)
  if (catalog?.configRevision !== (server.revision ?? 0)) return []

  const byName = new Map(overrides.map((tool) => [tool.name, tool]))

  return (await catalogRows(ctx, server)).map((row) => ({
    name: row.name,
    description: row.description,
    definitionRef: row.definitionRef,
    diagnostic: row.diagnostic,
    nameOverride: byName.get(row.name)?.nameOverride,
    descriptionOverride: byName.get(row.name)?.descriptionOverride,
    allowInReadOnly: byName.get(row.name)?.allowInReadOnly,
    enabled: byName.get(row.name)?.enabled,
  }))
}

async function currentCatalogId(ctx: QueryCtx, server: Doc<'mcpServers'>) {
  if (!server.catalogId) return undefined
  const catalog = await ctx.db.get(server.catalogId)
  return catalog?.configRevision === (server.revision ?? 0)
    ? server.catalogId
    : undefined
}
