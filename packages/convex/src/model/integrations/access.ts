import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject, requireRole } from '../../functions'
import type { AuthQueryCtx } from '../../functions'
import { hasInvocationAccess } from '../mcpRuntime'

export async function integrationActor(ctx: QueryCtx, subject: string) {
  const user = await findUserBySubject(ctx, subject)
  requireRole(user?.role, 'admin')
  return user!
}

export async function ownedIntegration(
  ctx: AuthQueryCtx,
  id: Id<'integrations'>,
) {
  requireRole(ctx.role, 'admin')
  const integration = await ctx.db.get(id)
  if (!integration || integration.ownerId !== ctx.userId)
    error('Integration not found', 404)
  return integration
}

/** Intersects each child's selection with its parent's live available set. */
export async function availableIntegrations(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  sessionId?: Id<'sessions'>,
  visited = new Set<string>(),
): Promise<Doc<'integrations'>[]> {
  const agent = await ctx.db.get(agentId)
  if (!agent) return []
  const rows = await ctx.db
    .query('integrations')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', agent.ownerId))
    .take(33)
  if (rows.length > 32) error('Integration capacity exceeded', 409)

  const session = sessionId ? await ctx.db.get(sessionId) : null
  if (sessionId && !session) return []
  if (session?.settings?.disabled || session?.contextLock) return []

  const selected = rows.filter((row) => {
    if (row.status !== 'ready') return false
    return !!agent.integrationIds?.includes(row._id)
  })
  if (!session?.parent) return selected
  if (visited.has(session._id))
    error('Invalid integration session hierarchy', 409)

  visited.add(session._id)

  const ceiling = await availableIntegrations(
    ctx,
    session.parent.agentId,
    session.parent.sessionId,
    visited,
  )
  const ids = new Set(ceiling.map((row) => row._id))

  return selected.filter((row) => ids.has(row._id))
}

export async function requireSelectionAccess(
  ctx: AuthQueryCtx,
  agentId: Id<'agents'>,
  sessionId?: Id<'sessions'>,
) {
  requireRole(ctx.role, 'admin')
  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Agent not found', 404)
  if (sessionId && !(await hasInvocationAccess(ctx, sessionId, ctx.userId)))
    error('Session not found', 404)
  return agent
}
