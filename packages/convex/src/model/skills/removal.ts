import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { assertAgentIdle, requireAdmin } from './access'
import { ensureHome, homeMembers } from './homes'

/** Reserves cleanup before deleting the last agent, retaining authority for retries. */
export async function prepareHomeRemoval(
  ctx: AuthMutationCtx,
  agent: Doc<'agents'>,
  removeFolder = false,
) {
  if (!removeFolder) return undefined

  requireAdmin(ctx)
  await assertAgentIdle(ctx, agent._id, ctx.userId)
  const home = await ensureHome(ctx, agent)
  await assertCanRemoveHome(ctx, home, agent._id)

  const operationId = await ctx.db.insert('agentFileOperations', {
    kind: 'delete-home',
    homeId: home._id,
    ownerId: ctx.userId,
    status: 'queued',
    updatedAt: Date.now(),
  })

  await ctx.db.patch(home._id, { operationId })
  await ctx.scheduler.runAfter(0, internal.actions.skills._run, { operationId })
  await ctx.scheduler.runAfter(10 * 60_000, internal.skills._watchdog, { operationId }) // prettier-ignore

  return operationId
}

/** Rejects deletion of custom folders or folders still used by another agent. */
export async function assertCanRemoveHome(
  ctx: MutationCtx,
  home: Doc<'agentHomes'>,
  agentId: Id<'agents'>,
) {
  if (!home.managed) error('Custom folders must be preserved', 409)
  // prettier-ignore
  if ((await homeMembers(ctx, home._id)).some((member) => member._id !== agentId))
    error('This folder is still shared by other agents', 409)
}

/** Releases one agent's membership, preserving the home for its other members. */
export async function detachHome(
  ctx: MutationCtx,
  op: Doc<'agentFileOperations'>,
) {
  if (!op.agentId || !op.homeId) error('Personal folder is not assigned', 409)

  const agent = await ctx.db.get(op.agentId)
  const home = await ctx.db.get(op.homeId)
  if (!agent || agent.homeId !== op.homeId || home?.operationId !== op._id)
    error('Personal folder changed during detachment', 409)
  if (op.removeFolder) await assertCanRemoveHome(ctx, home, agent._id)

  await ctx.db.patch(agent._id, {
    homeId: undefined,
  })

  if (op.removeFolder) {
    await ctx.scheduler.runAfter(0, internal.skills._cleanupHomeRecords, {
      homeId: home._id,
    })
  }
}

export async function assertRemovableHome(
  ctx: MutationCtx,
  homeId: Id<'agentHomes'>,
  operationId: Id<'agentFileOperations'>,
) {
  const home = await ctx.db.get(homeId)
  if (!home?.managed || (home.operationId && home.operationId !== operationId))
    error('Managed folder cleanup is no longer available', 409)
  if ((await homeMembers(ctx, homeId)).length)
    error('This folder is still used by another agent', 409)
  return home
}

/** Removes assignment records in bounded batches after filesystem cleanup succeeds. */
export async function cleanupRecords(
  ctx: MutationCtx,
  { homeId }: { homeId: Id<'agentHomes'> },
) {
  if ((await homeMembers(ctx, homeId)).length) return

  const rows = await ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) => q.eq('homeId', homeId))
    .take(100)
  for (const row of rows) await ctx.db.delete(row._id)

  if (rows.length === 100) {
    await ctx.scheduler.runAfter(0, internal.skills._cleanupHomeRecords, {
      homeId,
    })
  } else if (await ctx.db.get(homeId)) {
    await ctx.db.delete(homeId)
  }
}
