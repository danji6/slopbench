import { MAX_TOOLKITS, toolkitManifestSchema } from '@cv/core/types/toolkit'

import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthQueryCtx } from '../../functions'
import { requireRole } from '../../functions'
import type { ToolkitListArgs } from '../../types'
import * as Credentials from '../credentials'
import { getSessionWithWorkspace } from '../session/folderContext'
import { getMembership } from '../session/memberships'
import {
  availableToolkits,
  ownedToolkit,
  requireSelectionAccess,
} from './access'
import { componentRows } from './components'

export async function list(ctx: AuthQueryCtx, args: ToolkitListArgs) {
  requireRole(ctx.role, 'admin')
  if (args.agentId) await requireSelectionAccess(ctx, args.agentId)

  const rows = await ctx.db
    .query('toolkits')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ctx.userId))
    .take(MAX_TOOLKITS + 1)
  if (rows.length > MAX_TOOLKITS) error('Toolkit capacity exceeded', 409)

  const active = args.agentId ? await availableToolkits(ctx, args.agentId) : [] // prettier-ignore
  const agent = args.agentId ? await ctx.db.get(args.agentId) : null

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      description: toolkitManifestSchema.shape.description.parse(
        JSON.parse(row.manifest).description,
      ),
      selected: !!agent?.toolkitIds?.includes(row._id),
      effective: active.some((item) => item._id === row._id),
      cleanupPending: await pendingCleanupCount(ctx, row._id),
    })),
  )
}

async function pendingCleanupCount(ctx: AuthQueryCtx, id: Id<'toolkits'>) {
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
  args: { toolkitId: Id<'toolkits'> },
) {
  return ownedToolkit(ctx, args.toolkitId)
}

export async function sources(
  ctx: AuthQueryCtx,
  args: { sessionId: Id<'sessions'> },
) {
  const session = await getSessionWithWorkspace(ctx, args.sessionId)
  if (!session) return []

  if (session.ownerId === ctx.userId) {
    requireRole(ctx.role, 'admin')
    const membership = await getMembership(ctx, session._id, ctx.userId)
    if (membership?.role !== 'owner') error('Session not found', 404)
    if (session.contextLock) error('Folder sources are being updated', 409)
  } else {
    if (!session.activeAgentId) return []
    await requireSelectionAccess(ctx, session.activeAgentId, args.sessionId)
  }

  return (
    session.workspace?.sources?.filter(
      (source) => source.discoverToolkits === true,
    ) ?? []
  )
}

/** Lists credential names and component controls without exposing secret values or catalogs. */
export async function bindings(
  ctx: AuthQueryCtx,
  args: { toolkitId: Id<'toolkits'> },
) {
  const toolkit = await ownedToolkit(ctx, args.toolkitId)
  const keys = await Credentials.map(ctx, toolkit.ownerId, 'mcp')
  const secrets = await Credentials.map(ctx, toolkit.ownerId, 'mcp-env')
  const servers = await componentRows(ctx, toolkit._id)

  return servers.map((server) => ({
    _id: server._id,
    name: server.componentName!,
    transport: server.transport,
    enabled: server.enabled,
    hasKey: keys.has(server.key),
    secretEnvNames: Object.keys(JSON.parse(secrets.get(server.key) ?? '{}')),
  }))
}
