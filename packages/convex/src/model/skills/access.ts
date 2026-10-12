import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { requireRole } from '../../functions'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'

export function requireAdmin(ctx: AuthQueryCtx | AuthMutationCtx) {
  requireRole(ctx.role, 'admin')
}

export async function requireOwnedAgent(
  ctx: QueryCtx,
  id: Id<'agents'>,
  ownerId: Id<'users'>,
) {
  const agent = await ctx.db.get(id)
  if (!agent || agent.ownerId !== ownerId) {
    error('Agent not found', 404)
  }
  return agent
}

export async function requireOwnedSkill(
  ctx: QueryCtx,
  id: Id<'skills'>,
  ownerId: Id<'users'>,
) {
  const skill = await ctx.db.get(id)
  if (!skill || skill.ownerId !== ownerId) {
    error('Skill not found', 404)
  }
  return skill
}

/** Serializes configuration transitions against turn reservations for the agent. */
export async function assertAgentIdle(
  ctx: MutationCtx,
  id: Id<'agents'>,
  ownerId: Id<'users'>,
) {
  const agent = await requireOwnedAgent(ctx, id, ownerId)
  if (agent.fileOperationId)
    error('Wait for the personal folder operation to finish', 409)

  const stream = await ctx.db
    .query('streams')
    .withIndex('by_agentId', (q) => q.eq('agentId', id))
    .first()
  if (stream) error('Wait for this agent’s turns and tools to finish', 409)

  const processing = await ctx.db
    .query('messages')
    .withIndex('by_sender_status', (q) =>
      q
        .eq('sender.type', 'agent')
        .eq('sender.id', id)
        .eq('status', 'processing'),
    )
    .first()
  const job = await ctx.db
    .query('shellJobs')
    .withIndex('by_agentId', (q) => q.eq('agentId', id))
    .first()
  if (processing || job) {
    error(
      'Wait for this agent’s pending messages and shell jobs to finish',
      409,
    )
  }

  return agent
}

export async function assertAgentAvailable(ctx: QueryCtx, id: Id<'agents'>) {
  const agent = await ctx.db.get(id)
  if (agent?.fileOperationId) {
    error('Personal folder is being updated', 409)
  }
}
