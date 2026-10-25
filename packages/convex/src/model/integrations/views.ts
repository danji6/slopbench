import { MAX_INTEGRATIONS } from '@sb/core/types/integration'

import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthQueryCtx } from '../../functions'
import { requireRole } from '../../functions'
import type { IntegrationListArgs } from '../../types'
import * as Credentials from '../credentials'
import { getSessionWithWorkspace } from '../session/folderContext'
import {
  availableIntegrations,
  ownedIntegration,
  requireSelectionAccess,
} from './access'
import { componentRows } from './components'

export async function list(ctx: AuthQueryCtx, args: IntegrationListArgs) {
  requireRole(ctx.role, 'admin')
  if (args.agentId) await requireSelectionAccess(ctx, args.agentId)

  const rows = await ctx.db
    .query('integrations')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ctx.userId))
    .take(MAX_INTEGRATIONS + 1)
  if (rows.length > MAX_INTEGRATIONS)
    error('Integration capacity exceeded', 409)

  const active = args.agentId ? await availableIntegrations(ctx, args.agentId) : [] // prettier-ignore
  const agent = args.agentId ? await ctx.db.get(args.agentId) : null

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      selected: !!agent?.integrationIds?.includes(row._id),
      effective: active.some((item) => item._id === row._id),
      cleanupPending: await pendingCleanupCount(ctx, row._id),
    })),
  )
}

async function pendingCleanupCount(ctx: AuthQueryCtx, id: Id<'integrations'>) {
  let count = 0
  for (const server of await componentRows(ctx, id)) {
    const pending = await ctx.db
      .query('mcpCleanups')
      .withIndex('by_ownerId_serverKey', (q) =>
        q.eq('scope.ownerId', server.ownerId).eq('scope.serverId', server.key),
      )
      .take(65 - count)
    count += pending.length
    if (count >= 65) return count
  }
  return count
}

export async function get(
  ctx: AuthQueryCtx,
  args: { integrationId: Id<'integrations'> },
) {
  return ownedIntegration(ctx, args.integrationId)
}

export async function sources(
  ctx: AuthQueryCtx,
  args: { sessionId: Id<'sessions'> },
) {
  const session = await getSessionWithWorkspace(ctx, args.sessionId)
  if (!session?.activeAgentId) return []
  await requireSelectionAccess(ctx, session.activeAgentId, args.sessionId)
  return (
    session.workspace?.sources?.filter(
      (source) => source.discoverIntegrations === true,
    ) ?? []
  )
}

/** Lists credential names and component controls without exposing secret values or catalogs. */
export async function bindings(
  ctx: AuthQueryCtx,
  args: { integrationId: Id<'integrations'> },
) {
  const integration = await ownedIntegration(ctx, args.integrationId)
  const keys = await Credentials.map(ctx, integration.ownerId, 'mcp')
  const secrets = await Credentials.map(ctx, integration.ownerId, 'mcp-env')
  const servers = await componentRows(ctx, integration._id)

  return servers.map((server) => ({
    _id: server._id,
    name: server.componentName!,
    transport: server.transport,
    enabled: server.enabled,
    hasKey: keys.has(server.key),
    secretEnvNames: Object.keys(JSON.parse(secrets.get(server.key) ?? '{}')),
  }))
}
