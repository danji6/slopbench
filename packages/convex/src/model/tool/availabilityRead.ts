import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'

/** Finds retained results only within the current session and agent's ownership. */
export async function hasStoredMcpOutput(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  agent: Doc<'agents'>,
) {
  const result = await ctx.db
    .query('mcpOperations')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', sessionId).eq('agentId', agent._id),
    )
    .filter((q) =>
      q.and(
        q.eq(q.field('ownerId'), agent.ownerId),
        q.neq(q.field('deleted'), true),
        q.or(
          q.neq(q.field('output'), undefined),
          q.neq(q.field('outputRef'), undefined),
        ),
      ),
    )
    .first()
  return !!result
}
