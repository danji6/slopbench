import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { OperationAttemptArgs } from '../../types'
import { assertAgentIdle, requireAdmin } from './access'
import { finishOperation } from './completion'
import { ensureHome, homeMembers } from './homes'
import { matchesAttempt, scheduleOperation } from './lifecycle'

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
    state: { phase: 'queued' },
    attempt: 1,
    updatedAt: Date.now(),
  })

  await ctx.db.patch(home._id, { operationId })
  await scheduleOperation(ctx, { operationId, attempt: 1 })

  return operationId
}

/** Rejects deletion of custom folders or folders still used by another agent. */
export async function assertCanRemoveHome(
  ctx: MutationCtx,
  home: Doc<'agentHomes'>,
  agentId: Id<'agents'>,
) {
  if (!home.managed) error('Custom folders must be preserved', 409)
  const members = await homeMembers(ctx, home._id)
  const shared = members.some((member) => member._id !== agentId)
  if (shared) {
    error('This folder is still shared by other agents', 409)
  }
}

/** Releases one agent's membership, preserving the home for its other members. */
export async function detachHome(
  ctx: MutationCtx,
  op: Extract<Doc<'agentFileOperations'>, { kind: 'detach' }>,
) {
  const agent = await ctx.db.get(op.agentId)
  const home = await ctx.db.get(op.homeId)
  const changed =
    !agent || agent.homeId !== op.homeId || home?.operationId !== op._id
  if (changed) {
    error('Personal folder changed during detachment', 409)
  }
  if (op.removeFolder) await assertCanRemoveHome(ctx, home, agent._id)

  await ctx.db.patch(agent._id, {
    homeId: undefined,
  })
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

export async function scheduleCleanup(
  ctx: MutationCtx,
  args: OperationAttemptArgs,
) {
  await ctx.scheduler.runAfter(0, internal.skills._cleanupHomeRecords, args)
}

/** Deletes bounded record batches only for the current cleanup phase and attempt. */
export async function cleanupRecords(
  ctx: MutationCtx,
  args: OperationAttemptArgs,
) {
  const op = await ctx.db.get(args.operationId)
  if (!matchesAttempt(op, args.attempt)) return
  if (op.state.phase !== 'cleaning') return

  const removesHome =
    op.kind === 'delete-home' || (op.kind === 'detach' && op.removeFolder)
  if (!removesHome) return

  const home = await ctx.db.get(op.homeId)
  if (!home) {
    await finishOperation(ctx, op)
    return
  }
  if (!home.managed || home.operationId !== op._id) return

  const members = await homeMembers(ctx, home._id)
  if (members.length) return

  const hasMore = await deleteAssignmentBatch(ctx, home._id)
  await ctx.db.patch(op._id, { updatedAt: Date.now() })
  if (hasMore) {
    await scheduleCleanup(ctx, args)
    return
  }

  await ctx.db.delete(home._id)
  await finishOperation(ctx, op)
}

async function deleteAssignmentBatch(
  ctx: MutationCtx,
  homeId: Id<'agentHomes'>,
) {
  const batchSize = 100
  const rows = await ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_name', (q) => q.eq('homeId', homeId))
    .take(batchSize)
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length === batchSize
}
