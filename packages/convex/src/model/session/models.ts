import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { ModelSelection } from '../../types'
import { findModelSelection } from '../provider/providers'
import { resolve as resolveProviders } from '../providers'
import { getByOwnerId } from '../settings'

/** Resolves a session selection, preserving unknown model ids. */
export async function resolveSessionModel(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  modelId?: string,
): Promise<ModelSelection | undefined> {
  if (!modelId) return undefined

  const providers = await resolveProviders(ctx, ownerId)
  return findModelSelection(providers, modelId) ?? { id: modelId }
}

/** Refreshes chat model selections after the owner's providers change. */
export async function refreshForOwner(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  renames?: ReadonlyMap<string, string>,
) {
  if (renames?.size) await refreshRecentModel(ctx, ownerId, renames)
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
      const renamed = renames?.get(session.model.id)
      const model =
        findModelSelection(providers, renamed ?? session.model.id) ??
        (renamed ? { id: renamed } : session.model)
      await ctx.db.patch(session._id, { model })
    }
  }
}

async function refreshRecentModel(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  renames: ReadonlyMap<string, string>,
) {
  const settings = await getByOwnerId(ctx, ownerId)
  if (!settings?.recentModel) return
  const recentModel = renames.get(settings.recentModel)
  if (recentModel) await ctx.db.patch(settings._id, { recentModel })
}
