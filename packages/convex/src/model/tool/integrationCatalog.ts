'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { McpBrokerContext } from './mcpBroker'
import { connectMcpRuntime } from './mcpConnection'

/** Discovers a selected integration on its existing session client when a probe cannot resolve workspace values. */
export async function ensureIntegrationCatalog(
  context: McpBrokerContext,
  serverId?: string,
) {
  if (!serverId) return
  const { ctx, execution } = context.operation

  const available = await ctx.runQuery(
    internal.mcpCatalogs._available,
    execution,
  )

  const server = available.servers.find((row) => row.recordId === serverId)
  if (!server?.integrationId || server.catalogId) return

  const live = await context.current(server.id)
  if (!live?.runtime) throw new Error('Integration access revoked')

  const status = await connectMcpRuntime(live.server, live.runtime, context)
  const refresh = await ctx.runMutation(internal.mcpCatalogs._beginActive, {
    ...execution,
    serverId: serverId as Id<'mcpServers'>,
    immediate: true,
  })
  if (!refresh) return

  const { refreshCatalog } = await import('../mcpCatalogActions')

  await refreshCatalog(ctx, refresh.catalogId, {
    scope: live.runtime.scope,
    bootId: status.bootId,
    generation: status.generation,
    expiresAt: Date.now() + 30_000,
  })
}
