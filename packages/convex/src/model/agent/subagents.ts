import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AgentSubAgents } from '../../types'

export type SpawnableAgent = {
  _id: Id<'agents'>
  name: string
  description?: string
}

/** Drops ids that aren't the owner's agents, plus the agent itself. */
export async function sanitizeSubAgents(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  subAgents: AgentSubAgents<Id<'agents'>> | undefined,
  selfId?: Id<'agents'>,
): Promise<AgentSubAgents<Id<'agents'>> | undefined> {
  if (!subAgents) return undefined

  const agentIds: Id<'agents'>[] = []
  for (const id of new Set(subAgents.agentIds)) {
    if (id === selfId) continue
    const agent = await ctx.db.get(id)
    if (agent?.ownerId === ownerId) agentIds.push(id)
  }

  return { mode: subAgents.mode, agentIds }
}

/**
 * The agents an agent may spawn as sub-agents. Undefined config
 * (or allow + empty) means none.
 */
export async function resolveSpawnableAgents(
  ctx: QueryCtx,
  agent: Doc<'agents'>,
): Promise<SpawnableAgent[]> {
  const config = agent.subAgents
  if (!config) return []
  if (config.mode === 'allow' && config.agentIds.length === 0) return []

  const owned = await ctx.db
    .query('agents')
    .withIndex('by_ownerId_name', (q) => q.eq('ownerId', agent.ownerId))
    .order('asc')
    .collect()

  const listed = new Set<Id<'agents'>>(config.agentIds)
  return owned
    .filter(
      (candidate) =>
        candidate._id !== agent._id &&
        (config.mode === 'allow') === listed.has(candidate._id),
    )
    .map(({ _id, name, description }) => ({ _id, name, description }))
}
