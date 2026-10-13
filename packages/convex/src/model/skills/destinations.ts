import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { homeAtPath } from './homes'

/** Allows equal homes for one owner while rejecting nested or foreign homes. */
export async function assertHomeDestination(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  destination: string,
) {
  const agent = await ctx.db.get(agentId)
  if (!agent) error('Agent not found', 404)

  const same = await homeAtPath(ctx, destination)
  if (same && same.ownerId !== agent.ownerId)
    error('This personal folder belongs to another owner', 409)

  const separator = destination.includes('\\') ? '\\' : '/'
  const prefix = destination.endsWith(separator)
    ? destination
    : destination + separator

  const descendants = await ctx.db
    .query('agentHomes')
    .withIndex('by_path', (q) =>
      q.gte('path', prefix).lt('path', `${prefix}\uffff`),
    )
    .first()
  if (descendants) error('Personal folders cannot overlap another home', 409)

  let ancestor = destination
  while (ancestor) {
    const index = ancestor.lastIndexOf(separator)
    if (index < 0) break
    ancestor = ancestor.slice(0, index)
    if (ancestor && (await homeAtPath(ctx, ancestor)))
      error('Personal folders cannot overlap another home', 409)
  }

  // Legacy records and reservations remain authoritative while the migration runs.
  await checkLegacyPaths(ctx, agentId, agent.ownerId, destination)

  return same
}

async function checkLegacyPaths(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  ownerId: Id<'users'>,
  destination: string,
) {
  const separator = destination.includes('\\') ? '\\' : '/'
  const prefix = destination.endsWith(separator)
    ? destination
    : destination + separator

  for (const pending of [false, true]) {
    const index = pending ? 'by_pendingHomePath' : 'by_homePath'
    const field = pending ? 'pendingHomePath' : 'resolvedHomePath'

    const descendants = await ctx.db
      .query('agents')
      .withIndex(index, (q) =>
        q.gte(field, prefix).lt(field, `${prefix}\uffff`),
      )
      .take(2)
    if (descendants.some((row) => row._id !== agentId))
      error('Personal folders cannot overlap another home', 409)

    let ancestor = destination
    while (ancestor) {
      const rows = await ctx.db
        .query('agents')
        .withIndex(index, (q) => q.eq(field, ancestor))
        .collect()

      const overlap = rows.some(
        (row) =>
          row._id !== agentId &&
          (ancestor !== destination || row.ownerId !== ownerId || pending),
      )
      if (overlap) error('Personal folders cannot overlap another home', 409)

      const end = ancestor.lastIndexOf(separator)
      if (end < 0) break
      ancestor = ancestor.slice(0, end)
    }
  }
}
