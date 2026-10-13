import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthQueryCtx } from '../../functions'
import { requireAdmin, requireOwnedAgent } from './access'

type Home = Doc<'agentHomes'>

/** Creates a stable home identity without creating or moving filesystem contents. */
export async function ensureHome(ctx: MutationCtx, agent: Doc<'agents'>) {
  if (agent.homeId) {
    const home = await ctx.db.get(agent.homeId)
    if (home) return home
  }

  const path = agent.resolvedHomePath ?? agent.homePath
  const existing = path
    ? await homeAtPath(ctx, path)
    : (
        await ctx.db
          .query('agentHomes')
          .withIndex('by_ownerId', (q) => q.eq('ownerId', agent.ownerId))
          .collect()
      ).find((home) => home.managed && home.originAgentId === agent._id)

  if (existing && existing.ownerId !== agent.ownerId)
    error('This personal folder belongs to another owner', 409)

  const id =
    existing?._id ??
    (await ctx.db.insert('agentHomes', {
      ownerId: agent.ownerId,
      originAgentId: agent._id,
      managed: !agent.homePath,
      path,
      revision: agent.homeRevision ?? 0,
    }))

  await ctx.db.patch(agent._id, {
    homeId: id,
    homeDetached: false,
    homeOriginAgentId: existing?.originAgentId ?? agent._id,
  })

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

/** Projects shared home authority into legacy agent consumers during migration. */
export async function agentWithHome(ctx: QueryCtx, agentId: Id<'agents'>) {
  const agent = await ctx.db.get(agentId)
  if (!agent?.homeId) return agent
  const home = await ctx.db.get(agent.homeId)
  return home
    ? {
        ...agent,
        ...homeFields(home),
        fileOperationId: home.operationId ?? agent.fileOperationId,
      }
    : agent
}

export function homeFields(home: Home) {
  return {
    homeId: home._id,
    homeDetached: false,
    homeOriginAgentId: home.originAgentId,
    homePath: home.path,
    resolvedHomePath: home.path,
    homeRevision: home.revision,
  }
}

export async function bindHome(
  ctx: MutationCtx,
  agentId: Id<'agents'>,
  home: Home,
) {
  await ctx.db.patch(agentId, homeFields(home))
}

export async function getHome(
  ctx: AuthQueryCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  requireAdmin(ctx)
  const agent = await requireOwnedAgent(ctx, agentId, ctx.userId)
  const home = agent.homeId ? await ctx.db.get(agent.homeId) : null
  const members = home ? await homeMembers(ctx, home._id) : [agent]
  return {
    homeId: home?._id,
    path: home?.path ?? agent.resolvedHomePath ?? agent.homePath,
    customPath: home ? (home.managed ? undefined : home.path) : agent.homePath,
    managed: home?.managed ?? !agent.homePath,
    revision: home?.revision ?? agent.homeRevision ?? 0,
    operationId: home?.operationId ?? agent.fileOperationId,
    members: members.map((member) => ({ id: member._id, name: member.name })),
  }
}

/** Updates every member's revision so cached invocations cannot retain old skill state. */
export async function releaseHome(
  ctx: MutationCtx,
  homeId: Id<'agentHomes'>,
  operationId: Id<'agentFileOperations'>,
) {
  const home = await ctx.db.get(homeId)
  if (!home || home.operationId !== operationId) return
  const revision = home.revision + 1
  await ctx.db.patch(homeId, { operationId: undefined, revision })
  for (const member of await homeMembers(ctx, homeId)) {
    await ctx.db.patch(member._id, { homeRevision: revision })
  }
}
