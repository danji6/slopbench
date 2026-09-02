import { limitError } from '@sb/core/limit-errors'
import { MAX_MCP_SERVERS } from '@sb/core/limits'
import type { McpServer, McpToolMeta, McpTransport } from '@sb/core/types'
import { clampMcpTools } from '@sb/core/types'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import * as Credentials from './credentials'

/** What the settings UI renders. */
export type McpServerView = Omit<McpServer, 'apiKey'> & {
  _id: Id<'mcpServers'>
  hasKey: boolean
}

export async function list(ctx: AuthQueryCtx): Promise<McpServerView[]> {
  const servers = await listServers(ctx, ctx.userId)
  const keys = await Credentials.map(ctx, ctx.userId, 'mcp')

  return Promise.all(
    servers.map(async (server) => ({
      _id: server._id,
      id: server.key,
      label: server.label,
      url: server.url,
      transport: server.transport,
      enabled: server.enabled,
      tools: await listTools(ctx, server._id),
      hasKey: keys.has(server.key),
    })),
  )
}

/**
 * Servers joined with their tools. Only pass `withCredentials` if used
 * internally, never send them to the client.
 */
export async function resolve(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  { withCredentials = false } = {},
): Promise<McpServer[]> {
  const servers = await listServers(ctx, ownerId)
  const keys = withCredentials
    ? await Credentials.map(ctx, ownerId, 'mcp')
    : new Map<string, string>()

  return Promise.all(
    servers.map(async (server) => ({
      id: server.key,
      label: server.label,
      url: server.url,
      transport: server.transport,
      enabled: server.enabled,
      apiKey: keys.get(server.key),
      tools: await listTools(ctx, server._id),
    })),
  )
}

export type McpServerInput = {
  key: string
  label: string
  url: string
  transport: McpTransport
  enabled: boolean
  /** `undefined` leaves the stored credential alone; `''` clears it. */
  apiKey?: string
  /** `undefined` keeps the tools already discovered for this server. */
  tools?: McpToolMeta[]
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

  const existing = await listServers(ctx, ctx.userId)
  const byKey = new Map(existing.map((server) => [server.key, server]))
  const seen = new Set<string>()

  for (const [order, input] of servers.entries()) {
    const { apiKey, tools, ...fields } = input
    if (seen.has(fields.key)) continue
    seen.add(fields.key)

    const server = byKey.get(fields.key)
    let serverId: Id<'mcpServers'>
    if (server) {
      serverId = server._id
      await ctx.db.patch(serverId, { ...fields, order })
    } else {
      serverId = await ctx.db.insert('mcpServers', {
        ownerId: ctx.userId,
        ...fields,
        order,
      })
    }
    if (apiKey !== undefined) {
      await Credentials.set(ctx, ctx.userId, 'mcp', fields.key, apiKey)
    }
    if (tools) await writeTools(ctx, serverId, tools)
  }

  for (const server of existing) {
    if (seen.has(server.key)) continue
    for (const tool of await toolRows(ctx, server._id)) {
      await ctx.db.delete(tool._id)
    }
    await Credentials.remove(ctx, ctx.userId, 'mcp', server.key)
    await ctx.db.delete(server._id)
  }
}

/** Replaces a server's tool set. */
async function writeTools(
  ctx: AuthMutationCtx,
  serverId: Id<'mcpServers'>,
  tools: McpToolMeta[],
) {
  const next = clampMcpTools(tools)
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
        row.nameOverride === next[index].nameOverride &&
        row.description === next[index].description &&
        row.descriptionOverride === next[index].descriptionOverride &&
        row.inputSchema === next[index].inputSchema,
    )
  )
}

/** The server row, for ownership check. */
export async function get(
  ctx: AuthQueryCtx,
  { serverId }: { serverId: Id<'mcpServers'> },
) {
  const server = await ctx.db.get(serverId)
  if (!server || server.ownerId !== ctx.userId) error('Not found', 404)
  return { _id: server._id, url: server.url, transport: server.transport }
}

/** Internal only. Callers must have already proven the requester owns it. */
export async function _getApiKey(
  ctx: QueryCtx,
  { serverId }: { serverId: Id<'mcpServers'> },
) {
  const server = await ctx.db.get(serverId)
  if (!server) return undefined
  return Credentials.get(ctx, server.ownerId, 'mcp', server.key)
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

async function listTools(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<'mcpServers'>,
): Promise<McpToolMeta[]> {
  const rows = await toolRows(ctx, serverId)
  return rows.map(
    ({
      name,
      nameOverride,
      description,
      descriptionOverride,
      inputSchema,
    }) => ({
      name,
      nameOverride,
      description,
      descriptionOverride,
      inputSchema,
    }),
  )
}
