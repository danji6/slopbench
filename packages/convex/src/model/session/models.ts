import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { ModelEntry } from '../../types'
import { findModelEntry } from '../provider/providers'
import { resolve as resolveProviders } from '../providers'

/**
 * The model entry an agent resolves to, falling back to just the id when no
 * provider lists it. `undefined` when the agent has no model configured.
 */
export async function resolveAgentModel(
  ctx: QueryCtx | MutationCtx,
  agent: { ownerId: Id<'users'>; modelId?: string },
): Promise<ModelEntry | undefined> {
  if (!agent.modelId) return undefined

  const providers = await resolveProviders(ctx, agent.ownerId)
  return findModelEntry(providers, agent.modelId) ?? { id: agent.modelId }
}

/** Refreshes the denormalized active agent's model entry. */
export async function refreshForAgent(
  ctx: MutationCtx,
  agent: { _id: Id<'agents'>; ownerId: Id<'users'>; modelId?: string },
) {
  const providers = await resolveProviders(ctx, agent.ownerId)
  await pushModel(ctx, agent, providers)
}

/** Refreshes every agent this user owns, after a provider list edit. */
export async function refreshForOwner(ctx: MutationCtx, ownerId: Id<'users'>) {
  const providers = await resolveProviders(ctx, ownerId)

  const agents = await ctx.db
    .query('agents')
    .withIndex('by_ownerId_name', (q) => q.eq('ownerId', ownerId))
    .collect()

  for (const agent of agents) {
    await pushModel(ctx, agent, providers)
  }
}

async function pushModel(
  ctx: MutationCtx,
  agent: { _id: Id<'agents'>; modelId?: string },
  providers: Parameters<typeof findModelEntry>[0],
) {
  const model = agent.modelId
    ? (findModelEntry(providers, agent.modelId) ?? { id: agent.modelId })
    : undefined

  const links = await ctx.db
    .query('sessionAgents')
    .withIndex('by_agentId', (q) => q.eq('agentId', agent._id))
    .collect()

  for (const link of links) {
    const session = await ctx.db.get(link.sessionId)
    if (session?.activeAgentId !== agent._id) continue

    await ctx.db.patch(session._id, { model })
  }
}
