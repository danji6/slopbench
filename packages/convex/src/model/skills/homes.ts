import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthQueryCtx } from '../../functions'
import { requireAdmin, requireOwnedAgent } from './access'

/** Creates a home identity only for an explicitly requested filesystem operation. */
export async function ensureHome(ctx: MutationCtx, agent: Doc<'agents'>) {
  if (agent.homeId) {
    const home = await ctx.db.get(agent.homeId)
    if (!home) error('Personal folder record is missing', 409)
    return home
  }

  const existing = (
    await ctx.db
      .query('agentHomes')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', agent.ownerId))
      .collect()
  ).find((home) => home.managed && home.originAgentId === agent._id)
  const id =
    existing?._id ??
    (await ctx.db.insert('agentHomes', {
      ownerId: agent.ownerId,
      originAgentId: agent._id,
      managed: true,
      revision: 0,
    }))
  await ctx.db.patch(agent._id, { homeId: id })
  return (await ctx.db.get(id))!
}

export function homeAtPath(ctx: QueryCtx, path: string) {
  return ctx.db
    .query('agentHomes')
    .withIndex('by_path', (q) => q.eq('path', path))
    .unique()
}

export function homeMembers(ctx: QueryCtx, homeId: Id<'agentHomes'>) {
  return ctx.db
    .query('agents')
    .withIndex('by_homeId', (q) => q.eq('homeId', homeId))
    .collect()
}

/** Resolves personal-folder state from its shared authoritative record. */
export async function agentWithHome(ctx: QueryCtx, agentId: Id<'agents'>) {
  const agent = await ctx.db.get(agentId)
  return agent
    ? { ...agent, home: agent.homeId ? await ctx.db.get(agent.homeId) : null }
    : null
}

export async function bindHome(
  ctx: MutationCtx,
  agentId: Id<'agents'>,
  home: Doc<'agentHomes'>,
) {
  await ctx.db.patch(agentId, { homeId: home._id })
}

export async function getHome(
  ctx: AuthQueryCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  requireAdmin(ctx)
  const agent = await requireOwnedAgent(ctx, agentId, ctx.userId)
  const home = agent.homeId ? await ctx.db.get(agent.homeId) : null
  const members = home ? await homeMembers(ctx, home._id) : []
  return {
    homeId: home?._id,
    path: home?.path,
    managed: home?.managed ?? false,
    revision: home?.revision ?? 0,
    operationId: home?.operationId ?? agent.fileOperationId,
    members: members.map((member) => ({ id: member._id, name: member.name })),
  }
}

/** Releases the lease and advances the revision observed by every member's cache. */
export async function releaseHome(
  ctx: MutationCtx,
  homeId: Id<'agentHomes'>,
  operationId: Id<'agentFileOperations'>,
) {
  const home = await ctx.db.get(homeId)
  if (!home || home.operationId !== operationId) return
  await ctx.db.patch(homeId, {
    operationId: undefined,
    revision: home.revision + 1,
  })
}
