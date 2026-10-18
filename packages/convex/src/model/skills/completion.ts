import { errorMessage } from '@sb/core/utils/errors'

import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { CompleteAgentFileArgs, FailAgentFileArgs } from '../../types'
import { assertHomeDestination } from './destinations'
import { bindHome } from './homes'
import { scheduleHomeInvalidation } from './invalidation'
import {
  holdsAgentReservation,
  holdsOperationReservations,
  isExecutingOperation,
  matchesAttempt,
  releaseOperation,
  scheduleWatchdog,
} from './lifecycle'
import { detachHome, scheduleCleanup } from './removal'

type AgentOperation = Extract<Doc<'agentFileOperations'>, { agentId: unknown }>

/** Commits metadata once, then advances to the command's required finalization. */
export async function complete(ctx: MutationCtx, args: CompleteAgentFileArgs) {
  const op = await ctx.db.get(args.operationId)

  if (!isExecutingOperation(op, args.attempt)) {
    return false
  }
  if (op.kind !== args.result.kind) {
    error('Unexpected filesystem operation result', 409)
  }

  const reservationExpired =
    'agentId' in op && !(await holdsAgentReservation(ctx, op.agentId, op._id))
  if (reservationExpired) {
    error('Personal folder operation expired', 409)
  }

  const previousPath =
    'homeId' in op ? (await ctx.db.get(op.homeId))?.path : undefined

  await commitMetadata(ctx, op, args)

  if (op.kind === 'home' || op.kind === 'detach') {
    const state = { phase: 'invalidating' as const, previousPath }
    await ctx.db.patch(op._id, { state, updatedAt: Date.now() })
    await scheduleHomeInvalidation(ctx, { ...op, state })
    await scheduleWatchdog(ctx, argsIdentity(args))
    return false
  }

  if (op.kind === 'delete-home') {
    await ctx.db.patch(op._id, {
      state: { phase: 'cleaning' },
      updatedAt: Date.now(),
    })
    await scheduleCleanup(ctx, argsIdentity(args))
    await scheduleWatchdog(ctx, argsIdentity(args))
    return false
  }

  return finishOperation(ctx, op)
}

function argsIdentity(args: CompleteAgentFileArgs) {
  return { operationId: args.operationId, attempt: args.attempt }
}

async function commitMetadata(
  ctx: MutationCtx,
  op: Doc<'agentFileOperations'>,
  args: CompleteAgentFileArgs,
) {
  switch (op.kind) {
    case 'detach':
      return detachHome(ctx, op)
    case 'assign':
      await commitAssignment(ctx, op)
      if (args.result.kind === 'assign')
        await commitHome(ctx, op.agentId, op.homeId, args.result.path)
      return
    case 'delete-assigned':
      if (await ctx.db.get(op.assignmentId))
        await ctx.db.delete(op.assignmentId)
      return
    case 'delete-library':
      if (!(await holdsOperationReservations(ctx, op)))
        error('Library deletion reservation expired', 409)
      if (op.mode === 'delete-all') {
        const remaining = await ctx.db
          .query('agentSkills')
          .withIndex('by_skillId', (q) => q.eq('skillId', op.skillId))
          .first()
        if (remaining) error('Assigned copies must finish deleting first', 409)
      }
      if (await ctx.db.get(op.skillId)) await ctx.db.delete(op.skillId)
      return
    case 'home':
    case 'ensure':
      if (args.result.kind === op.kind) {
        if (!op.reservation) error('Destination folder was not reserved', 409)
        await commitHome(
          ctx,
          op.agentId,
          op.reservation.homeId,
          args.result.path,
        )
      }
      return
    case 'duplicate':
      if (args.result.kind === 'duplicate') {
        await commitHome(
          ctx,
          op.duplicateId,
          op.destinationHomeId,
          args.result.path,
        )
      }
      return
    case 'install':
    case 'delete-home':
      return
  }
}

async function commitAssignment(
  ctx: MutationCtx,
  op: Extract<AgentOperation, { kind: 'assign' }>,
) {
  const skill = await ctx.db.get(op.skillId)
  if (!skill || skill.operationId !== op._id)
    error('Skill no longer exists', 409)

  const existing = await ctx.db
    .query('agentSkills')
    .withIndex('by_homeId_skillId', (q) =>
      q.eq('homeId', op.homeId).eq('skillId', skill._id),
    )
    .first()
  if (!existing) {
    await ctx.db.insert('agentSkills', {
      ownerId: op.ownerId,
      homeId: op.homeId,
      skillId: skill._id,
      name: skill.name,
      description: skill.description,
    })
  }
}

async function commitHome(
  ctx: MutationCtx,
  agentId: AgentOperation['agentId'],
  homeId: AgentOperation['homeId'],
  path: string,
) {
  await assertHomeDestination(ctx, agentId, path)
  const home = await ctx.db.get(homeId)
  if (!home) error('Personal folder no longer exists', 409)
  await ctx.db.patch(home._id, { path })
  await bindHome(ctx, agentId, { ...home, path })
}

/** Releases leases when every required phase has finished. */
export async function finishOperation(
  ctx: MutationCtx,
  op: Doc<'agentFileOperations'>,
) {
  await releaseOperation(ctx, op)
  const failedImport = op.kind === 'install' && op.progress.summary.failed > 0
  const state = failedImport
    ? {
        phase: 'failed' as const,
        error: op.progress.error ?? 'Some skills could not be installed',
      }
    : { phase: 'done' as const }
  await ctx.db.patch(op._id, { state, updatedAt: Date.now() })
  return !failedImport
}

/** Fails only the queued or executing attempt; committed finalization is recovered separately. */
export async function fail(ctx: MutationCtx, args: FailAgentFileArgs) {
  const op = await ctx.db.get(args.operationId)
  if (!matchesAttempt(op, args.attempt)) return
  const canFail = op.state.phase === 'queued' || op.state.phase === 'executing'
  if (!canFail) return

  const importingSkillId =
    op.kind === 'install' ? op.progress.skillId : undefined
  if (importingSkillId && (await ctx.db.get(importingSkillId))) {
    await ctx.db.patch(importingSkillId, { status: 'failed' })
  }

  await releaseOperation(ctx, op)

  const message = (
    errorMessage(args.message) ?? 'Filesystem operation failed'
  ).slice(0, 500)

  await ctx.db.patch(op._id, {
    state: { phase: 'failed', error: message },
    updatedAt: Date.now(),
  })
}
