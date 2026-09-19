import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import { type AuthMutationCtx } from '../../functions'
import type { UpdateSessionArgs } from '../../types'
import { requireMember } from './memberships'

export async function requireOwnedAgent(
  ctx: AuthMutationCtx,
  agentId: Id<'agents'>,
) {
  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
  return agent
}

export async function requireActiveAgentOwner(
  ctx: AuthMutationCtx,
  sessionId: Id<'sessions'>,
) {
  const { session } = await requireMember(ctx, sessionId, ctx.userId)
  if (!session.activeAgentId) error('No active agent', 409)

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent) error('Agent not found', 404)
  if (agent.ownerId !== ctx.userId) error('Forbidden', 403)
  return agent
}

export async function requireLinkedAgent(
  ctx: AuthMutationCtx,
  sessionId: { sessionId: Id<'sessions'> }['sessionId'],
  agentId: NonNullable<UpdateSessionArgs['activeAgentId']>,
) {
  const link = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', sessionId).eq('agentId', agentId),
    )
    .unique()

  if (!link) error('Agent is not linked to this session', 409)
}
