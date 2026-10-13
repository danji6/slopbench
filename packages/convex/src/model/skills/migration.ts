import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { ensureHome } from './homes'

/** Preserves legacy paths and waits for pending work before assigning home identity. */
export async function migrateAgentHome(ctx: MutationCtx, agent: Doc<'agents'>) {
  if (agent.fileOperationId) {
    const operation = await ctx.db.get(agent.fileOperationId)
    if (operation && ['queued', 'running'].includes(operation.status))
      throw new Error(
        'Wait for personal folder operations to finish before migrating',
      )
    await ctx.db.patch(agent._id, { fileOperationId: undefined })
  }
  await ensureHome(ctx, agent)
}

/** Rehomes assignment metadata without touching customized filesystem contents. */
export async function migrateHomeSkill(
  ctx: MutationCtx,
  assignment: Doc<'agentSkills'>,
) {
  if (assignment.homeId) return

  const agent = await ctx.db.get(assignment.agentId)
  if (!agent) return

  const home = await ensureHome(ctx, agent)

  const existing = await ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) =>
      q.eq('homeId', home._id).eq('name', assignment.name),
    )
    .first()

  if (existing) await ctx.db.delete(assignment._id)
  else await ctx.db.patch(assignment._id, { homeId: home._id })
}
