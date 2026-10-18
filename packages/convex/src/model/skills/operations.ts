import type { Doc, Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { FileOperationArgs } from '../../types'
import { assertAgentIdle, requireAdmin } from './access'
import { prepareLibraryDeletion } from './libraryDeletion'
import {
  claimOperation,
  operationTargets,
  scheduleOperation,
} from './lifecycle'
import { validateOperationArgs } from './operationArgs'
import {
  assertHomeMissingSkill,
  prepareOperation,
  preparedFields,
  preparedTargets,
  requireAvailableSkill,
} from './preparation'
import { assertCanRemoveHome, assertRemovableHome } from './removal'

/** Reserves filesystem work using the command's validated resources. */
export async function start(ctx: AuthMutationCtx, args: FileOperationArgs) {
  requireAdmin(ctx)
  validateOperationArgs(args)
  const prepared = await prepareOperation(ctx, args)
  const attempt = 1
  const id = await ctx.db.insert('agentFileOperations', {
    ...preparedFields(prepared),
    ownerId: ctx.userId,
    state: { phase: 'queued' },
    attempt,
    updatedAt: Date.now(),
  })
  await claimOperation(ctx, id, preparedTargets(prepared))
  await scheduleOperation(ctx, { operationId: id, attempt })
  return id
}

/** Reclaims a failed execution after rechecking its current targets and ownership. */
export async function retry(
  ctx: AuthMutationCtx,
  args: { operationId: Id<'agentFileOperations'> },
) {
  requireAdmin(ctx)

  const op = await ctx.db.get(args.operationId)
  const retryable = op && op.ownerId === ctx.userId && op.state.phase === 'failed' // prettier-ignore
  if (!retryable) error('Operation not found', 404)

  if (await alreadyDeleted(ctx, op)) {
    await ctx.db.patch(op._id, {
      state: { phase: 'done' },
      updatedAt: Date.now(),
    })
    return
  }

  await validateRetry(ctx, op)

  if (op.kind === 'delete-library') {
    const skill = await requireAvailableSkill(ctx, op.skillId, op.kind)
    const targets = await prepareLibraryDeletion(ctx, skill)
    op.homeIds = targets.map(({ home }) => home._id)
    await ctx.db.patch(op._id, { homeIds: op.homeIds })
  }

  const attempt = op.attempt + 1
  const progress =
    op.kind === 'install'
      ? {
          progress: {
            cursor: 0,
            summary: { installed: 0, skipped: 0, failed: 0 },
          },
        }
      : {}
  const targets = operationTargets(op)
  if (op.kind === 'install') targets.skillId = undefined

  await claimOperation(ctx, op._id, targets)
  await ctx.db.patch(op._id, {
    state: { phase: 'queued' },
    attempt,
    updatedAt: Date.now(),
    ...progress,
  })
  await scheduleOperation(ctx, { operationId: op._id, attempt })
}

async function alreadyDeleted(
  ctx: AuthMutationCtx,
  op: Doc<'agentFileOperations'>,
) {
  if (op.kind === 'delete-assigned') return !(await ctx.db.get(op.assignmentId))
  if (op.kind === 'delete-library') return !(await ctx.db.get(op.skillId))
  return false
}

async function validateRetry(
  ctx: AuthMutationCtx,
  op: Doc<'agentFileOperations'>,
) {
  if (op.kind === 'delete-home') {
    const home = await assertRemovableHome(ctx, op.homeId, op._id)
    if (home.ownerId !== ctx.userId)
      error('Managed folder ownership changed', 409)
  }

  for (const { agentId, homeId } of operationTargets(op).agents) {
    const agent = await assertAgentIdle(ctx, agentId, ctx.userId)
    if (agent.homeId !== homeId)
      error('The agent changed folders. Start a new operation instead.', 409)
  }

  await validateRetryHome(ctx, op)

  if (!('skillId' in op) || !op.skillId) return

  const skill = await requireAvailableSkill(ctx, op.skillId, op.kind)
  if (op.kind === 'assign')
    await assertHomeMissingSkill(ctx, op.homeId, skill.name)
}

async function validateRetryHome(
  ctx: AuthMutationCtx,
  op: Doc<'agentFileOperations'>,
) {
  if (op.kind === 'detach' && op.removeFolder) {
    const home = await ctx.db.get(op.homeId)
    if (!home) error('Personal folder is not assigned', 409)
    await assertCanRemoveHome(ctx, home, op.agentId)
  }
  if ('reservation' in op && op.reservation) {
    const home = await ctx.db.get(op.reservation.homeId)
    const unavailable =
      !home ||
      home.ownerId !== ctx.userId ||
      (home.operationId && home.operationId !== op._id)
    if (unavailable) {
      error('Destination changed during retry', 409)
    }
  }
}
