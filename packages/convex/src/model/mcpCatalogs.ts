import {
  MAX_MCP_CATALOG_BYTES,
  MAX_MCP_CATALOG_TOOLS,
} from '@sb/core/types/mcp-catalog'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import { minRole } from '../lib/roles'
import type {
  McpCatalogAppendArgs,
  McpCatalogBeginArgs,
  McpCatalogFailureArgs,
  McpCatalogIdArgs,
  McpCatalogPageArgs,
  McpCatalogPublishArgs,
} from '../types'
import type { McpCatalogActiveArgs, StreamExecutionArgs } from '../types'
import type { McpCatalogActiveFailureArgs } from '../types'
import { available } from './mcpCatalogAccess'
import { hasPins } from './mcpCatalogPins'
import { launchConnection } from './mcpLaunch'
import { revokeRestrictedTargets } from './mcpPolicyRevocation'
import { isAuthorized, runtimeScope } from './mcpRuntime'

/** Reports automatic refresh failures without changing the published revision. */
export async function activeFailure(
  ctx: MutationCtx,
  args: McpCatalogActiveFailureArgs,
) {
  const { agent, servers } = await available(ctx, args)
  const server = await ctx.db.get(args.serverId)

  if (!server || server.ownerId !== agent.ownerId) return
  if (!servers.some((candidate) => candidate.id === server.key)) return

  await ctx.db.patch(server._id, {
    catalogError: args.error.slice(0, 2_000),
    catalogRetryAt: Date.now() + 60_000,
  })
}

/** Checks ownership before exposing even a catalog summary. */
export async function ownedServer(
  ctx: AuthQueryCtx,
  serverId: Id<'mcpServers'>,
) {
  const server = await ctx.db.get(serverId)
  if (!server || server.ownerId !== ctx.userId)
    error('MCP server not found', 404)
  if (server.transport === 'stdio' && !minRole(ctx.role, 'admin'))
    error('Forbidden', 403)
  return server
}

/** Reserves a refresh without changing the usable catalog. */
export async function begin(ctx: AuthMutationCtx, args: McpCatalogBeginArgs) {
  const server = await ownedServer(ctx, args.serverId)
  return beginRefresh(ctx, server)
}

async function beginRefresh(ctx: MutationCtx, server: Doc<'mcpServers'>) {
  const revisions = await ctx.db
    .query('mcpCatalogs')
    .withIndex('by_serverId', (q) => q.eq('serverId', server._id))
    .take(65)
  if (revisions.length >= 64) {
    error(
      'MCP catalog revision capacity reached; retained session definitions cannot be silently deleted',
      409,
    )
  }

  const ownerRevisions = await ctx.db
    .query('mcpCatalogs')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', server.ownerId))
    .take(129)
  if (ownerRevisions.length >= 128) {
    error(
      'MCP retained catalog capacity reached; reset unneeded frozen session caches before refreshing',
      409,
    )
  }

  const catalogId = await ctx.db.insert('mcpCatalogs', {
    ownerId: server.ownerId,
    serverId: server._id,
    configRevision: server.revision ?? 0,
    previousId: server.catalogId,
    state: 'staging',
    count: 0,
    bytes: 0,
    createdAt: Date.now(),
  })
  await ctx.db.patch(server._id, {
    pendingCatalogId: catalogId,
    catalogRetryAt: undefined,
    catalogError: undefined,
  })
  await ctx.scheduler.runAfter(
    30 * 60_000,
    internal.actions.mcpCatalogs._expire,
    { catalogId },
  )

  return catalogId
}

/** Resolves credentials only for the server-side refresh action. */
export async function launch(ctx: QueryCtx, args: McpCatalogIdArgs) {
  const catalog = await staging(ctx, args.catalogId)
  const server = (await ctx.db.get(catalog.serverId))!
  return launchConnection(ctx, server)
}

async function staging(ctx: QueryCtx, id: Id<'mcpCatalogs'>) {
  const catalog = await ctx.db.get(id)

  if (!catalog || catalog.state !== 'staging')
    error('MCP catalog refresh is no longer active', 409)
  if (Date.now() - catalog.createdAt > 30 * 60_000)
    error('MCP catalog refresh expired', 409)

  const server = await ctx.db.get(catalog.serverId)
  if (!server || server.pendingCatalogId !== id)
    error('MCP catalog refresh was superseded', 409)
  if ((server.revision ?? 0) !== catalog.configRevision)
    error('MCP configuration changed during discovery', 409)

  return catalog
}

/** Adds a bounded page to a private revision; retrying an identical page is safe. */
export async function append(ctx: MutationCtx, args: McpCatalogAppendArgs) {
  const catalog = await staging(ctx, args.catalogId)
  if (args.tools.length > 32) error('MCP catalog page is too large', 400)
  let count = catalog.count
  let bytes = catalog.bytes

  for (const tool of args.tools) {
    const previous = await ctx.db
      .query('mcpCatalogTools')
      .withIndex('by_catalogId_order', (q) =>
        q.eq('catalogId', catalog._id).eq('order', tool.order),
      )
      .unique()
    if (previous) {
      const pageIdentityChanged =
        previous.definitionRef !== tool.definitionRef ||
        previous.name !== tool.name
      if (pageIdentityChanged) error('MCP catalog page identity changed', 409)
      continue
    }

    if (tool.order !== count) error('MCP catalog page is out of sequence', 409)
    const duplicate = await ctx.db
      .query('mcpCatalogTools')
      .withIndex('by_catalogId_name', (q) =>
        q.eq('catalogId', catalog._id).eq('name', tool.name),
      )
      .unique()
    if (duplicate) error('Duplicate MCP tool name', 400)

    count++
    bytes += tool.bytes

    if (count > MAX_MCP_CATALOG_TOOLS || bytes > MAX_MCP_CATALOG_BYTES)
      error('MCP catalog capacity exceeded', 413)

    await ctx.db.insert('mcpCatalogTools', {
      ...tool,
      catalogId: catalog._id,
      serverId: catalog.serverId,
    })
  }
  const retained = await ctx.db
    .query('mcpCatalogs')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', catalog.ownerId))
    .collect()

  const retainedBytes =
    retained.reduce((sum, row) => sum + row.bytes, 0) - catalog.bytes + bytes

  if (retainedBytes > 256 * 1024 * 1024)
    error('MCP retained definition storage capacity reached', 413)

  await ctx.db.patch(catalog._id, { count, bytes })
}

/** Publishes one complete revision atomically; failed refreshes leave the pointer intact. */
export async function publish(ctx: MutationCtx, args: McpCatalogPublishArgs) {
  const catalog = await staging(ctx, args.catalogId)
  await assertRuntimeCurrent(ctx, catalog)
  if (catalog.count !== args.count) error('MCP catalog is incomplete', 409)

  const previous = catalog.previousId
    ? await ctx.db.get(catalog.previousId)
    : null

  const unchangedDefinitions =
    previous?.fingerprint === args.fingerprint &&
    previous.configRevision === catalog.configRevision

  if (unchangedDefinitions) {
    await ctx.db.patch(catalog._id, { state: 'redundant' })
    await ctx.db.patch(catalog.serverId, {
      pendingCatalogId: undefined,
      catalogError: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.actions.mcpCatalogs._expire, {
      catalogId: catalog._id,
    })

    return previous._id
  }

  await assertActiveCapacity(ctx, catalog)
  await ctx.db.patch(catalog._id, {
    state: 'ready',
    fingerprint: args.fingerprint,
  })
  await ctx.db.patch(catalog.serverId, {
    catalogId: catalog._id,
    catalogCount: catalog.count,
    pendingCatalogId: undefined,
    catalogError: undefined,
  })
  if (catalog.previousId) {
    await ctx.scheduler.runAfter(60_000, internal.actions.mcpCatalogs._expire, {
      catalogId: catalog.previousId,
    })
  }
  const server = (await ctx.db.get(catalog.serverId))!
  await revokeRestrictedTargets(ctx, catalog.ownerId, server.key)

  return catalog._id
}

export async function fail(ctx: MutationCtx, args: McpCatalogFailureArgs) {
  const catalog = await ctx.db.get(args.catalogId)
  if (!catalog || catalog.state !== 'staging') return

  const message = args.error.slice(0, 2_000)
  await ctx.db.patch(catalog._id, { state: 'failed', error: message })
  const server = await ctx.db.get(catalog.serverId)

  if (server?.pendingCatalogId === catalog._id) {
    await ctx.db.patch(server._id, {
      pendingCatalogId: undefined,
      catalogError: message,
      catalogRetryAt: Date.now() + 60_000,
    })
  }
}

/** Reads bounded catalog summaries; complete definitions use storage references. */
export async function page(ctx: AuthQueryCtx, args: McpCatalogPageArgs) {
  const server = await ownedServer(ctx, args.serverId)
  const cursorRevisionChanged =
    args.paginationOpts.cursor && args.catalogId !== server.catalogId

  if (!server.catalogId || cursorRevisionChanged) {
    return {
      page: [],
      continueCursor: '',
      isDone: true,
      catalogId: server.catalogId,
      count: server.catalogCount ?? 0,
      error: server.catalogError,
    }
  }

  const paginationOpts = {
    ...args.paginationOpts,
    numItems: Math.min(50, args.paginationOpts.numItems),
  }
  const result = await ctx.db
    .query('mcpCatalogTools')
    .withIndex('by_catalogId_order', (q) =>
      q.eq('catalogId', server.catalogId!),
    )
    .paginate(paginationOpts)

  return {
    ...result,
    catalogId: server.catalogId,
    count: server.catalogCount ?? 0,
    error: server.catalogError,
    refreshing: !!server.pendingCatalogId,
  }
}

export async function definitionUrl(
  ctx: AuthQueryCtx,
  args: { serverId: Id<'mcpServers'>; toolId: Id<'mcpCatalogTools'> },
) {
  const server = await ownedServer(ctx, args.serverId)
  const tool = await ctx.db.get(args.toolId)
  if (!tool) return null

  const currentTarget =
    tool.serverId === server._id && tool.catalogId === server.catalogId
  if (!currentTarget) return null

  return ctx.storage.getUrl(tool.definitionRef)
}

/** Releases only unpublished revisions; published definitions may be frozen in history. */
export async function expire(ctx: MutationCtx, args: McpCatalogIdArgs) {
  const catalog = await ctx.db.get(args.catalogId)
  if (!catalog) return false
  const server = await ctx.db.get(catalog.serverId)

  if (server?.catalogId === catalog._id) {
    return false
  }
  if (catalog.state === 'ready' && (await hasPins(ctx, catalog))) {
    return false
  }

  const rows = await ctx.db
    .query('mcpCatalogTools')
    .withIndex('by_catalogId_order', (q) => q.eq('catalogId', catalog._id))
    .take(32)

  for (const row of rows) {
    await ctx.storage.delete(row.definitionRef)
    await ctx.db.delete(row._id)
  }

  if (rows.length === 32) return true

  if (server?.pendingCatalogId === catalog._id) {
    await ctx.db.patch(server._id, {
      pendingCatalogId: undefined,
      catalogError: 'MCP catalog refresh expired; previous catalog retained',
    })
  }

  await ctx.db.delete(catalog._id)

  return false
}

/** Resolves compact catalog rows without loading their schemas into stream state. */
export async function catalogRows(ctx: QueryCtx, server: Doc<'mcpServers'>) {
  if (!server.catalogId) return []
  return ctx.db
    .query('mcpCatalogTools')
    .withIndex('by_catalogId_order', (q) =>
      q.eq('catalogId', server.catalogId!),
    )
    .collect()
}

export async function references(ctx: QueryCtx, args: McpCatalogIdArgs) {
  return (
    await ctx.db
      .query('mcpCatalogTools')
      .withIndex('by_catalogId_order', (q) => q.eq('catalogId', args.catalogId))
      .collect()
  ).map((row) => row.definitionRef)
}

export async function activeRuntimes(ctx: QueryCtx, args: StreamExecutionArgs) {
  const { stream, servers } = await available(ctx, args)
  const rows = await ctx.db
    .query('mcpRuntimes')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', stream.sessionId))
    .collect()

  return rows
    .filter(
      (row) =>
        row.agentId === stream.agentId &&
        row.state === 'connected' &&
        servers.some((server) => server.id === row.serverKey),
    )
    .map((row) => ({
      scope: runtimeScope(row),
      initialization: row.initialization,
      bootId: row.bootId,
      generation: row.generation,
      serverId: servers.find((server) => server.id === row.serverKey)!.recordId,
    }))
}

/** Schedules a stale active catalog refresh only at an authorized provider boundary. */
export async function beginActive(
  ctx: MutationCtx,
  args: McpCatalogActiveArgs,
) {
  const { stream, agent, servers } = await available(ctx, args)
  const server = await ctx.db.get(args.serverId)

  if (!server || server.ownerId !== agent.ownerId) return
  if (!servers.some((candidate) => candidate.id === server.key)) return
  if (server.pendingCatalogId) return
  if ((server.catalogRetryAt ?? 0) > Date.now()) return

  const runtime = await ctx.db
    .query('mcpRuntimes')
    .withIndex('by_sessionId_agentId_serverKey', (q) =>
      q
        .eq('sessionId', stream.sessionId)
        .eq('agentId', stream.agentId)
        .eq('serverKey', server.key),
    )
    .unique()

  if (!runtime) return
  if (runtime.state !== 'connected') return
  const handshakeMissing = !runtime.bootId || !runtime.generation
  if (handshakeMissing) return
  if (!(await isAuthorized(ctx, runtime))) return

  const catalogId = await beginRefresh(ctx, server)

  await ctx.db.patch(catalogId, {
    runtimeId: runtime._id,
    runtimeKey: runtime.key,
  })
  await ctx.scheduler.runAfter(0, internal.actions.mcpCatalogs._refreshActive, {
    catalogId,
    runtimeId: runtime._id,
    key: runtime.key,
  })
}

async function assertRuntimeCurrent(
  ctx: QueryCtx,
  catalog: Doc<'mcpCatalogs'>,
) {
  if (catalog.runtimeId) {
    const runtime = await ctx.db.get(catalog.runtimeId)
    if (!runtime || runtime.key !== catalog.runtimeKey)
      error('MCP catalog runtime was replaced', 409)
    if (runtime.state !== 'connected')
      error('MCP catalog runtime was replaced', 409)
    if (!(await isAuthorized(ctx, runtime)))
      error('MCP catalog runtime was revoked', 403)
  }
}

async function assertActiveCapacity(
  ctx: QueryCtx,
  catalog: Doc<'mcpCatalogs'>,
) {
  const servers = await ctx.db
    .query('mcpServers')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', catalog.ownerId))
    .collect()
  const otherCount = servers
    .filter((server) => server._id !== catalog.serverId)
    .reduce((sum, server) => sum + (server.catalogCount ?? 0), 0)
  if (otherCount + catalog.count > 5_000)
    error('MCP active catalog capacity reached for this owner', 413)
}
