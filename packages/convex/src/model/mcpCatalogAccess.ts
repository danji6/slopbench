import { sha256 } from '@sb/core/sha256'
import { type McpServer, mcpToolName } from '@sb/core/types'

import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { error } from '../errors'
import { minRole } from '../lib/roles'
import type {
  McpCatalogSearchArgs,
  McpCatalogTargetArgs,
  StreamExecutionArgs,
} from '../types'
import type { McpCatalogDefinitionAccessArgs } from '../types'
import { resolve } from './mcp'
import { requireExecution } from './mcpOperationAccess'
import { hasInvocationAccess } from './mcpRuntime'
import {
  canReadMcpTool,
  isMcpServerSelected,
  isMcpToolSelected,
} from './mcpToolPolicy'
import { getSessionWithWorkspace } from './session/folderContext'

/** Catalog visibility follows the same live agent and local-process authority as execution. */
async function catalogActor(ctx: QueryCtx, execution: StreamExecutionArgs) {
  const stream = await requireExecution(ctx, execution)
  const agent = await ctx.db.get(stream.agentId)
  const invoker = await ctx.db.get(stream.invokedBy)
  const session = await getSessionWithWorkspace(ctx, stream.sessionId)

  if (!agent || !invoker || !session) {
    error('MCP catalog access revoked', 403)
  }
  if (session.settings?.disabled || session.contextLock) {
    error('MCP catalog access revoked', 403)
  }
  if (!(await hasInvocationAccess(ctx, session._id, invoker._id))) {
    error('MCP catalog access revoked', 403)
  }

  return { stream, agent, invoker }
}

export async function available(ctx: QueryCtx, execution: StreamExecutionArgs) {
  const { stream, agent, invoker } = await catalogActor(ctx, execution)

  const servers = (
    await resolve(ctx, agent.ownerId, {
      agentId: agent._id,
      sessionId: stream.sessionId,
    })
  ).filter((server) => {
    if (!server.enabled) return false
    if (server.transport === 'stdio' && !minRole(invoker.role, 'admin'))
      return false
    return isMcpServerSelected(agent, server)
  })

  return { stream, agent, servers }
}

/** Rejects handles from other owners, servers, revisions or unselected targets. */
export async function target(ctx: QueryCtx, args: McpCatalogTargetArgs) {
  const { agent, servers } = await available(ctx, args)
  const stored = await ctx.db.get(args.serverId)
  const server = servers.find((server) => server.id === stored?.key)
  const tool = await ctx.db.get(args.toolId)

  if (!server) {
    error('MCP target unavailable', 404)
  }
  if (!tool || tool.serverId !== args.serverId) {
    error('MCP target unavailable', 404)
  }
  if (stored?.ownerId !== agent.ownerId) {
    error('MCP target unavailable', 404)
  }
  if (tool.catalogId !== server.catalogId) {
    error('MCP catalog target is stale; search again', 409)
  }

  const selected = server.tools?.find((meta) => meta.name === tool.name)
  if (!selected) {
    error('MCP target is restricted', 403)
  }

  const selectedTarget = args.forDefinition
    ? canReadMcpTool(agent, server, selected)
    : isMcpToolSelected(agent, server, selected)
  if (!selectedTarget) {
    error('MCP target is restricted', 403)
  }

  const catalog = await ctx.db.get(tool.catalogId)
  if (catalog?.configRevision !== (stored?.revision ?? 0)) {
    error('MCP configuration changed; refresh the catalog', 409)
  }
  if (!catalog?.fingerprint) {
    error('MCP catalog revision unavailable; refresh the catalog', 409)
  }

  return { server, tool, selected, catalogRevision: catalog.fingerprint }
}

/** Lists servers first, then searches a selected server's bounded catalog page. */
export async function search(ctx: QueryCtx, args: McpCatalogSearchArgs) {
  const { agent, servers } = await available(ctx, args)
  const limit = Math.max(1, Math.min(25, args.limit))
  if (args.query.length > 200) error('MCP search query is too long', 400)

  if (!args.serverId) return listServers(ctx, servers, args, limit)
  const stored = await ctx.db.get(args.serverId)
  const server = servers.find((server) => server.id === stored?.key)
  if (!server || stored?.ownerId !== agent.ownerId)
    error('MCP server unavailable', 404)

  if (!server.catalogId) {
    return {
      tools: [],
      diagnostic:
        'Refresh this saved server in MCP settings to recover its complete catalog.',
      nextCursor: null,
    }
  }

  const catalog = await ctx.db.get(
    server.catalogId as Doc<'mcpCatalogs'>['_id'],
  )
  if (catalog?.configRevision !== (stored.revision ?? 0))
    error('MCP configuration changed; refresh the catalog', 409)

  const fingerprint = await sha256(
    JSON.stringify([
      server.catalogId,
      args.query,
      agent.tools,
      server.tools?.map((tool) => [
        tool.name,
        tool.enabled,
        tool.nameOverride,
        tool.allowInReadOnly,
      ]),
    ]),
  )

  const offset = cursorOffset(args.cursor, fingerprint)

  const rows = await ctx.db
    .query('mcpCatalogTools')
    .withIndex('by_catalogId_order', (q) =>
      q.eq('catalogId', stored.catalogId!),
    )
    .collect()

  const policies = new Map(server.tools?.map((tool) => [tool.name, tool]))
  const needle = args.query.toLocaleLowerCase()

  const matches = rows.filter((row) => {
    const policy = policies.get(row.name)
    if (!policy) return false
    const selected = canReadMcpTool(agent, server, policy)
    const text =
      `${row.name} ${policy.nameOverride ?? ''} ${row.description ?? ''}`.toLocaleLowerCase()
    return selected && text.includes(needle)
  })

  return {
    catalogId: server.catalogId,
    catalogRevision: catalog?.fingerprint,
    total: matches.length,
    tools: matches.slice(offset, offset + limit).map((row) => ({
      toolId: row._id,
      serverId: args.serverId,
      name: row.name,
      alias: mcpToolName(server, policies.get(row.name)!),
      description: row.description,
      descriptionTruncated: row.descriptionTruncated,
      diagnostic: row.diagnostic,
      definitionBytes: row.bytes,
    })),
    nextCursor: nextCursor(offset, limit, matches.length, fingerprint),
  }
}

async function listServers(
  ctx: QueryCtx,
  servers: McpServer[],
  args: McpCatalogSearchArgs,
  limit: number,
) {
  const fingerprint = await sha256(
    JSON.stringify(
      servers.map((server) => [server.id, server.catalogId, server.revision]),
    ) + args.query,
  )
  const offset = cursorOffset(args.cursor, fingerprint)
  const matching = servers.filter((server) =>
    server.label.toLowerCase().includes(args.query.toLowerCase()),
  )
  const page = []

  for (const server of matching.slice(offset, offset + limit)) {
    const catalog = server.catalogId
      ? await ctx.db.get(server.catalogId as Doc<'mcpCatalogs'>['_id'])
      : null
    // Legacy servers have no opaque catalog identity until explicitly refreshed
    page.push({
      serverId: server.recordId,
      label: server.label,
      count: server.catalogCount,
      catalogId: server.catalogId,
      catalogRevision: catalog?.fingerprint,
      diagnostic:
        server.catalogError ??
        (!catalog
          ? 'Refresh this server in MCP settings to enable broker access.'
          : undefined),
    })
  }

  return {
    servers: page,
    nextCursor: nextCursor(offset, limit, matching.length, fingerprint),
  }
}

function cursorOffset(cursor: string | undefined, fingerprint: string) {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(cursor)
    if (parsed.fingerprint !== fingerprint) throw new Error('stale')
    const offsetInRange =
      Number.isSafeInteger(parsed.offset) && parsed.offset >= 0
    if (!offsetInRange) throw new Error('invalid offset')
    return parsed.offset as number
  } catch {
    error('MCP search cursor is stale or invalid; search again', 409)
  }
}

function nextCursor(
  offset: number,
  limit: number,
  count: number,
  fingerprint: string,
) {
  return offset + limit < count
    ? JSON.stringify({ offset: offset + limit, fingerprint })
    : null
}

/** Frozen references remain readable only by the owner of their published catalog. */
export async function definitionAccess(
  ctx: QueryCtx,
  args: McpCatalogDefinitionAccessArgs,
) {
  const { agent } = await catalogActor(ctx, args)
  const tool = await ctx.db
    .query('mcpCatalogTools')
    .withIndex('by_definitionRef', (q) =>
      q.eq('definitionRef', args.definitionRef),
    )
    .unique()

  const catalog = tool ? await ctx.db.get(tool.catalogId) : null
  if (!catalog) {
    error('MCP definition access denied', 403)
  }
  if (catalog.ownerId !== agent.ownerId) {
    error('MCP definition access denied', 403)
  }
  if (catalog.state !== 'ready') {
    error('MCP definition access denied', 403)
  }

  return true
}
