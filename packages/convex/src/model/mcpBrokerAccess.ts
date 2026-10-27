import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type {
  McpBrokerOutputArgs,
  McpBrokerSearchArgs,
  McpBrokerServerArgs,
  McpBrokerTargetArgs,
  StreamExecutionArgs,
} from '../types'
import { assignName, findName } from './mcpBrokerNames'
import {
  available,
  target as catalogTarget,
  search as searchCatalog,
} from './mcpCatalogAccess'
import { outputAccess, requireExecution } from './mcpOperationAccess'

/** Registers server labels without launching their processes. */
export async function servers(ctx: MutationCtx, args: StreamExecutionArgs) {
  const { stream, servers } = await available(ctx, args)
  const named = []
  for (const server of servers) {
    const name = await assignName(
      ctx,
      stream.sessionId,
      'server',
      server.recordId!,
      server.label || 'MCP server',
    )
    const catalog = server.catalogId
      ? await ctx.db.get(server.catalogId as Id<'mcpCatalogs'>)
      : null
    named.push({
      ...server,
      name,
      catalogRevision: catalog?.fingerprint,
      catalogUpdatedAt: catalog
        ? new Date(catalog.createdAt).toISOString()
        : undefined,
    })
  }
  return named
}

export async function server(ctx: QueryCtx, args: McpBrokerServerArgs) {
  const { stream, servers } = await available(ctx, args)
  const binding = await findName(ctx, stream.sessionId, 'server', args.server)
  const server = servers.find((row) => row.recordId === binding?.target)
  if (!server)
    error('MCP server unavailable; search for available servers', 404)
  return server
}

/** Resolves a callable name and applies every existing catalog and live-access guard. */
export async function target(ctx: QueryCtx, args: McpBrokerTargetArgs) {
  const stream = await requireExecution(ctx, args)

  const binding = await findName(ctx, stream.sessionId, 'tool', args.tool)
  if (!binding)
    error('Unknown MCP tool name; search_mcp_tools before calling it', 404)

  const tool = await ctx.db.get(binding.target as Id<'mcpCatalogTools'>)
  if (!tool) error('MCP tool name is stale; search again', 409)

  return catalogTarget(ctx, {
    ...args,
    serverId: tool.serverId,
    toolId: tool._id,
  })
}

/** Assigns names only to the bounded page actually exposed by discovery. */
export async function search(ctx: MutationCtx, args: McpBrokerSearchArgs) {
  const { stream } = await available(ctx, args)
  const selected = args.server
    ? await server(ctx, { ...args, server: args.server })
    : undefined
  const page = await searchCatalog(ctx, {
    ...args,
    serverId: selected?.recordId as Id<'mcpServers'> | undefined,
  })
  return 'servers' in page
    ? serverPage(ctx, stream.sessionId, page)
    : toolPage(ctx, stream.sessionId, args.server!, page)
}

type CatalogPage = Awaited<ReturnType<typeof searchCatalog>>
type ServerPage = Extract<CatalogPage, { servers: unknown }>
type ToolPage = Exclude<CatalogPage, ServerPage>

async function serverPage(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  page: ServerPage,
) {
  const servers = []
  for (const row of page.servers) {
    const name = await assignName(
      ctx,
      sessionId,
      'server',
      row.serverId!,
      row.label || 'MCP server',
    )
    servers.push({
      name,
      count: row.count,
      catalogRevision: row.catalogRevision,
      diagnostic: row.diagnostic,
    })
  }
  return { servers, nextCursor: page.nextCursor }
}

async function toolPage(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  server: string,
  page: ToolPage,
) {
  const tools = []
  for (const row of page.tools ?? []) {
    const name = await assignName(ctx, sessionId, 'tool', row.toolId, row.name)
    tools.push({
      name,
      originalName: row.name,
      server,
      description: row.description,
      descriptionTruncated: row.descriptionTruncated,
      diagnostic: row.diagnostic,
      definitionBytes: row.definitionBytes,
    })
  }
  return {
    tools,
    catalogRevision:
      'catalogRevision' in page ? page.catalogRevision : undefined,
    total: 'total' in page ? page.total : undefined,
    diagnostic: 'diagnostic' in page ? page.diagnostic : undefined,
    nextCursor: page.nextCursor,
  }
}

export async function output(ctx: QueryCtx, args: McpBrokerOutputArgs) {
  const stream = await requireExecution(ctx, args)

  const binding = await findName(ctx, stream.sessionId, 'output', args.output)
  if (!binding) {
    error(
      'MCP output unavailable; use the output name returned by the call',
      404,
    )
  }

  return outputAccess(ctx, {
    ...args,
    operationId: binding.target as Id<'mcpOperations'>,
  })
}
