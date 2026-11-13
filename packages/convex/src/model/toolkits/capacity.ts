import { MAX_MCP_SERVERS } from '@cv/core/limits'
import { MAX_TOOLKITS } from '@cv/core/types/toolkit'

import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'

/** Bounds reactive configuration documents explicitly, separately from paginated tool catalogs. */
export async function assertConfigurationCapacity(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
) {
  const installations = await ctx.db
    .query('toolkits')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .take(MAX_TOOLKITS + 1)

  const servers = await ctx.db
    .query('mcpServers')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', ownerId))
    .take(MAX_MCP_SERVERS + 1)

  if (installations.length > MAX_TOOLKITS)
    error('Toolkit capacity reached', 409)
  if (servers.length > MAX_MCP_SERVERS)
    error('MCP server capacity reached', 409)

  let bytes = new TextEncoder().encode(JSON.stringify(installations)).length
  for (const server of servers) {
    if (!server.toolkitId) continue

    const policies = await ctx.db
      .query('mcpTools')
      .withIndex('by_serverId_order', (q) => q.eq('serverId', server._id))
      .take(5001)
    if (policies.length > 5000)
      error('Toolkit tool policy capacity reached', 409)

    bytes += new TextEncoder().encode(JSON.stringify([server, policies])).length
    if (bytes > 768 * 1024) {
      error(
        'Toolkit configuration capacity exceeds 768 KiB; catalogs remain stored separately',
        413,
      )
    }
  }
  if (bytes > 768 * 1024) {
    error('Toolkit configuration capacity exceeds 768 KiB', 413)
  }
}
