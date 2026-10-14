import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { FileOperationArgs } from '../../types'
import { assertAgentIdle, requireAdmin, requireOwnedSkill } from './access'
import {
  claimOperation,
  holdsOperationReservations,
  scheduleOperation,
} from './lifecycle'
import type { OperationTargets } from './lifecycle'
import { validateOperationArgs } from './operationArgs'
import {
  assertHomeMissingSkill,
  assertSkillUnused,
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
  const id = await ctx.db.insert('agentFileOperations', {
    ...preparedFields(prepared),
    ownerId: ctx.userId,
    status: 'queued',
    updatedAt: Date.now(),
  })
  await claimOperation(ctx, id, preparedTargets(prepared))
  await scheduleOperation(ctx, id)
  return id
}

/** Reclaims a failed operation after rechecking its current targets and ownership. */
export async function retry(
  ctx: AuthMutationCtx,
  args: { operationId: Id<'agentFileOperations'> },
) {
  requireAdmin(ctx)
  const operation = await requireFailedOperation(ctx, args.operationId)
  if (await alreadyDeleted(ctx, operation)) {
    await ctx.db.patch(operation._id, {
      status: 'done',
      error: undefined,
      updatedAt: Date.now(),
    })
    return
  }
  if (operation.kind === 'delete-home' && operation.homeId) {
    await assertRemovableHome(ctx, operation.homeId, operation._id)
    await ctx.db.patch(operation.homeId, { operationId: operation._id })
  }
  const targets = await validateRetryTargets(ctx, operation)
  await claimOperation(ctx, operation._id, targets)
  await queueRetry(ctx, operation)
}

async function queueRetry(
  ctx: AuthMutationCtx,
  operation: Doc<'agentFileOperations'>,
) {
  await ctx.db.patch(operation._id, {
    status: 'queued',
    error: undefined,
    finishingHome: undefined,
    previousHomePath: undefined,
    updatedAt: Date.now(),
    ...(operation.kind === 'install'
      ? {
          importCursor: 0,
          importSummary: { installed: 0, skipped: 0, failed: 0 },
          importError: undefined,
        }
      : {}),
  })
  await scheduleOperation(ctx, operation._id)
}

async function requireFailedOperation(
  ctx: AuthMutationCtx,
  id: Id<'agentFileOperations'>,
) {
  const operation = await ctx.db.get(id)
  const invalid =
    !operation ||
    operation.ownerId !== ctx.userId ||
    operation.status !== 'failed'
  if (invalid) error('Operation not found', 404)
  return operation
}

async function alreadyDeleted(
  ctx: AuthMutationCtx,
  operation: Doc<'agentFileOperations'>,
) {
  if (operation.kind === 'delete-assigned' && operation.assignmentId)
    return !(await ctx.db.get(operation.assignmentId))
  if (operation.kind === 'delete-library' && operation.skillId)
    return !(await ctx.db.get(operation.skillId))
  return false
}

async function validateRetryTargets(
  ctx: AuthMutationCtx,
  operation: Doc<'agentFileOperations'>,
): Promise<OperationTargets> {
  const agents: OperationTargets['agents'] = []
  const agent = await validateRetryHome(ctx, operation)
  await validateRetrySkill(ctx, operation, agent)

  for (const id of [operation.agentId, operation.duplicateId]) {
    if (!id) continue
    const agent = await assertAgentIdle(ctx, id, ctx.userId)
    agents.push({ agentId: agent._id, homeId: agent.homeId })
  }

  return { agents, skillId: operation.skillId }
}

async function validateRetryHome(
  ctx: AuthMutationCtx,
  operation: Doc<'agentFileOperations'>,
) {
  const agent = operation.agentId ? await ctx.db.get(operation.agentId) : null

  const changedHome =
    operation.agentId && operation.homeId && agent?.homeId !== operation.homeId
  if (changedHome)
    error('The agent changed folders. Start a new operation instead.', 409)

  const removalHomeId =
    operation.kind === 'detach' && operation.removeFolder && operation.homeId
  if (removalHomeId) {
    const home = await ctx.db.get(removalHomeId)
    if (!home || !agent) error('Personal folder is not assigned', 409)
    await assertCanRemoveHome(ctx, home, agent._id)
  }

  return agent
}

async function validateRetrySkill(
  ctx: AuthMutationCtx,
  operation: Doc<'agentFileOperations'>,
  agent: Doc<'agents'> | null,
) {
  if (!operation.skillId) return
  const skill =
    operation.kind === 'install'
      ? await requireOwnedSkill(ctx, operation.skillId, ctx.userId)
      : await requireAvailableSkill(ctx, operation.skillId, operation.kind)
  if (skill.operationId) error('Library operation in progress', 409)

  if (operation.kind === 'delete-library')
    await assertSkillUnused(ctx, skill._id)

  if (operation.kind === 'assign') {
    if (!agent?.homeId) error('Personal folder is not assigned', 409)
    await assertHomeMissingSkill(ctx, agent.homeId, skill.name)
  }
}

export type OperationContext = {
  operation: Doc<'agentFileOperations'>
  agent: Doc<'agents'> | null
  skill: Doc<'skills'> | null
  home?: Doc<'agentHomes'> | null
  destinationHome?: Doc<'agentHomes'> | null
}

/** Claims a queued operation once, while checking its current filesystem leases. */
export async function running(
  ctx: MutationCtx,
  args: { operationId: Id<'agentFileOperations'> },
) {
  const operation = await ctx.db.get(args.operationId)
  if (!operation || operation.status !== 'queued') return false
  if (operation.kind === 'delete-home' && operation.homeId)
    await assertRemovableHome(ctx, operation.homeId, operation._id)

  if (!(await holdsOperationReservations(ctx, operation))) return false

  const attempt = (operation.attempt ?? 0) + 1
  await ctx.db.patch(args.operationId, {
    attempt,
    status: 'running',
    updatedAt: Date.now(),
  })

  return attempt
}
