import type { Doc, Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { ensureForUser } from '../settings'

/** Records explicit selection of an agent owned by the current user. */
export async function rememberSelection(
  ctx: AuthMutationCtx,
  agent: Doc<'agents'>,
) {
  if (agent.ownerId !== ctx.userId) return
  await ctx.db.patch(agent._id, { lastSelectedAt: Date.now() })
}

/** Updates the new-chat selection and its recency atomically. */
export async function select(
  ctx: AuthMutationCtx,
  { agentId }: { agentId: Id<'agents'> | null },
) {
  if (agentId) {
    const agent = await ctx.db.get(agentId)
    if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
    await rememberSelection(ctx, agent)
  }
  await ensureForUser(ctx, ctx.userId, {
    recentAgentId: agentId ?? undefined,
  })
}
