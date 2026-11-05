import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject, requireRole } from '../../functions'
import type { AuthQueryCtx } from '../../functions'
import { hasInvocationAccess } from '../mcpRuntime'

export async function toolkitActor(ctx: QueryCtx, subject: string) {
  const user = await findUserBySubject(ctx, subject)
  requireRole(user?.role, 'admin')
  return user!
}

export async function ownedToolkit(ctx: AuthQueryCtx, id: Id<'toolkits'>) {
  requireRole(ctx.role, 'admin')
  const toolkit = await ctx.db.get(id)
  if (!toolkit || toolkit.ownerId !== ctx.userId)
    error('Toolkit not found', 404)
  return toolkit
}

/** Intersects each child's selection with its parent's live available set. */
export async function availableToolkits(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  sessionId?: Id<'sessions'>,
  visited = new Set<string>(),
): Promise<Doc<'toolkits'>[]> {
  const agent = await ctx.db.get(agentId)
  if (!agent) return []
  const rows = await ctx.db
    .query('toolkits')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', agent.ownerId))
    .take(33)
  if (rows.length > 32) error('Toolkit capacity exceeded', 409)

  const session = sessionId ? await ctx.db.get(sessionId) : null
  if (sessionId && !session) return []
  if (session?.settings?.disabled || session?.contextLock) return []

  const selected = rows.filter((row) => {
    if (row.status !== 'ready') return false
    return !!agent.toolkitIds?.includes(row._id)
  })
  if (!session?.parent) return selected
  if (visited.has(session._id)) error('Invalid toolkit session hierarchy', 409)

  visited.add(session._id)

  const ceiling = await availableToolkits(
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
