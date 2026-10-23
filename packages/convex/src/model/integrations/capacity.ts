import { MAX_MCP_SERVERS } from '@sb/core/limits'
import { MAX_INTEGRATIONS } from '@sb/core/types/integration'

import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'

/** Bounds reactive configuration documents explicitly, separately from paginated tool catalogs. */
export async function assertConfigurationCapacity(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
) {
  const installations = await ctx.db
    .query('integrations')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .take(MAX_INTEGRATIONS + 1)

  const servers = await ctx.db
    .query('mcpServers')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', ownerId))
    .take(MAX_MCP_SERVERS + 1)

  if (installations.length > MAX_INTEGRATIONS)
    error('Integration capacity reached', 409)
  if (servers.length > MAX_MCP_SERVERS)
    error('MCP server capacity reached', 409)

  let bytes = new TextEncoder().encode(JSON.stringify(installations)).length
  for (const server of servers) {
    if (!server.integrationId) continue

    const policies = await ctx.db
      .query('mcpTools')
      .withIndex('by_serverId_order', (q) => q.eq('serverId', server._id))
      .take(5001)
    if (policies.length > 5000)
      error('Integration tool policy capacity reached', 409)

    bytes += new TextEncoder().encode(JSON.stringify([server, policies])).length
    if (bytes > 768 * 1024) {
      error(
        'Integration configuration capacity exceeds 768 KiB; catalogs remain stored separately',
        413,
      )
    }
  }
  if (bytes > 768 * 1024) {
    error('Integration configuration capacity exceeds 768 KiB', 413)
  }
}
