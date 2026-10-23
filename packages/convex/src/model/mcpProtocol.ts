import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import { authorize, findUserBySubject } from '../functions'
import type { AuthQueryCtx } from '../functions'
import { minRole } from '../lib/roles'
import type { McpProtocolPublishArgs } from '../types'
import { ownedServer } from './mcpCatalogs'
import { launchConnection } from './mcpLaunch'

/** Resolves credentials only inside the backend after current ownership and role checks. */
export async function settingsLaunch(
  ctx: QueryCtx,
  { serverId }: { serverId: Id<'mcpServers'> },
) {
  const stored = await settingsServer(ctx, serverId)
  await assertCapacity(ctx, stored.ownerId, 0)
  return {
    ...(await launchConnection(ctx, stored)),
    revision: stored.revision ?? 0,
  }
}

async function settingsServer(ctx: QueryCtx, serverId: Id<'mcpServers'>) {
  const identity = await authorize(ctx)
  const user = await findUserBySubject(ctx, identity.subject)
  const stored = await ctx.db.get(serverId)

  if (!user || stored?.ownerId !== user._id) {
    error('MCP server unavailable', 404)
  }
  if (stored.integrationId) {
    error('Integration servers are accessed by agents', 403)
  }
  if (!stored.enabled) {
    error('Enable and save the MCP server first', 409)
  }
  if (stored.transport === 'stdio' && !minRole(user.role, 'admin')) {
    error('Forbidden', 403)
  }

  return stored
}

/** Publishes a temporary settings artifact only if its launch revision still applies. */
export async function publish(ctx: MutationCtx, args: McpProtocolPublishArgs) {
  const server = await settingsServer(ctx, args.serverId)

  if (!server.enabled || (server.revision ?? 0) !== args.revision)
    error('MCP configuration changed during the check', 409)
  await assertCapacity(ctx, server.ownerId, args.bytes)

  const checkId = await ctx.db.insert('mcpProtocolChecks', {
    ...args,
    ownerId: server.ownerId,
    expiresAt: Date.now() + 15 * 60_000,
  })

  await ctx.scheduler.runAfter(15 * 60_000, internal.mcpProtocol._expire, {
    checkId,
  })

  return checkId
}

export async function check(
  ctx: AuthQueryCtx,
  { checkId }: { checkId: Id<'mcpProtocolChecks'> },
) {
  const record = await ctx.db.get(checkId)
  if (!record) return null
  if (record.ownerId !== ctx.userId) error('MCP check unavailable', 404)
  if (!(await ctx.db.get(record.serverId))) return null

  const server = await ownedServer(ctx, record.serverId)
  const configurationRevoked = !server.enabled || (server.revision ?? 0) !== record.revision // prettier-ignore
  if (configurationRevoked || record.expiresAt <= Date.now()) return null

  return ctx.storage.getUrl(record.resultRef)
}

export async function expire(
  ctx: MutationCtx,
  { checkId }: { checkId: Id<'mcpProtocolChecks'> },
) {
  const record = await ctx.db.get(checkId)
  if (!record) return
  await ctx.storage.delete(record.resultRef)
  await ctx.db.delete(record._id)
}

export async function reference(
  ctx: QueryCtx,
  { resultRef }: { resultRef: Id<'_storage'> },
) {
  return !!(await ctx.db
    .query('mcpProtocolChecks')
    .withIndex('by_resultRef', (q) => q.eq('resultRef', resultRef))
    .unique())
}

async function assertCapacity(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  bytes: number,
) {
  const checks = await ctx.db
    .query('mcpProtocolChecks')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .take(65)
  if (
    checks.length >= 64 ||
    checks.reduce((total, check) => total + check.bytes, bytes) >
      128 * 1024 * 1024
  ) {
    error(
      'MCP settings check capacity reached; wait for temporary checks to expire',
      409,
    )
  }
}
