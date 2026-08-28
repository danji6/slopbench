import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { ModelEntry } from '../../types'
import { findModelEntry } from '../provider/providers'
import { resolve as resolveProviders } from '../providers'

/** Resolves a session selection, preserving unknown model ids. */
export async function resolveSessionModel(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  modelId?: string,
): Promise<ModelEntry | undefined> {
  if (!modelId) return undefined

  const providers = await resolveProviders(ctx, ownerId)
  return findModelEntry(providers, modelId) ?? { id: modelId }
}

/** Refreshes model metadata for sessions running one of this user's agents. */
export async function refreshForOwner(ctx: MutationCtx, ownerId: Id<'users'>) {
  const providers = await resolveProviders(ctx, ownerId)

  const agents = await ctx.db
    .query('agents')
    .withIndex('by_ownerId_name', (q) => q.eq('ownerId', ownerId))
    .collect()

  for (const agent of agents) {
    const links = await ctx.db
      .query('sessionAgents')
      .withIndex('by_agentId', (q) => q.eq('agentId', agent._id))
      .collect()

    for (const link of links) {
      const session = await ctx.db.get(link.sessionId)
      if (session?.activeAgentId !== agent._id || !session.model) continue

      const model =
        findModelEntry(providers, session.model.id) ??
        ({ id: session.model.id } as ModelEntry)
      await ctx.db.patch(session._id, { model })
    }
  }
}
