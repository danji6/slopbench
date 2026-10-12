import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'

/** Rejects equal, ancestor and descendant homes belonging to other agents. */
export async function assertHomeDestination(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  destination: string,
) {
  const separator = destination.includes('\\') ? '\\' : '/'
  const prefix = destination.endsWith(separator)
    ? destination
    : destination + separator

  const descendants = await ctx.db
    .query('agents')
    .withIndex('by_homePath', (q) =>
      q
        .gte('resolvedHomePath', prefix)
        .lt('resolvedHomePath', `${prefix}\uffff`),
    )
    .take(2)

  const pending = await ctx.db
    .query('agents')
    .withIndex('by_pendingHomePath', (q) =>
      q.gte('pendingHomePath', prefix).lt('pendingHomePath', `${prefix}\uffff`),
    )
    .take(2)

  if (
    [...descendants, ...pending].some((agent) => agent && agent._id !== agentId)
  ) {
    error('Personal folders cannot overlap another agent’s home', 409)
  }

  let ancestor = destination
  while (ancestor) {
    const existing = await ctx.db
      .query('agents')
      .withIndex('by_homePath', (q) => q.eq('resolvedHomePath', ancestor))
      .take(2)

    const reserved = await ctx.db
      .query('agents')
      .withIndex('by_pendingHomePath', (q) => q.eq('pendingHomePath', ancestor))
      .take(2)

    if (
      [...existing, ...reserved].some((agent) => agent && agent._id !== agentId)
    ) {
      error('Personal folders cannot overlap another agent’s home', 409)
    }

    const index = ancestor.lastIndexOf(separator)
    if (index < 0) break
    ancestor = ancestor.slice(0, index)
  }
}
