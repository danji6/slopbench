import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { releaseHome } from './homes'

type Operation = Doc<'agentFileOperations'>
type AgentReservation = { agentId: Id<'agents'>; homeId?: Id<'agentHomes'> }
export type OperationTargets = {
  agents: AgentReservation[]
  skillId?: Id<'skills'>
}

/** Matches callbacks that supply an attempt, retaining support for older callers. */
export function matchesAttempt(operation: Operation, attempt?: number) {
  return attempt === undefined || operation.attempt === attempt
}

export function isRunningOperation(
  operation: Operation | null,
  attempt?: number,
): operation is Operation {
  return (
    !!operation &&
    operation.status === 'running' &&
    matchesAttempt(operation, attempt)
  )
}

export async function holdsAgentReservation(
  ctx: QueryCtx,
  agentId: Id<'agents'>,
  operationId: Id<'agentFileOperations'>,
) {
  return (await ctx.db.get(agentId))?.fileOperationId === operationId
}

export async function holdsSkillReservation(
  ctx: QueryCtx,
  skillId: Id<'skills'>,
  operationId: Id<'agentFileOperations'>,
) {
  return (await ctx.db.get(skillId))?.operationId === operationId
}

/** Checks the claims required before a queued execution may start. */
export async function holdsOperationReservations(ctx: QueryCtx, op: Operation) {
  for (const id of [op.agentId, op.duplicateId]) {
    if (id && !(await holdsAgentReservation(ctx, id, op._id))) return false
  }
  return !op.skillId || holdsSkillReservation(ctx, op.skillId, op._id)
}

/** Claims targets already resolved within the current mutation. */
export async function claimOperation(
  ctx: MutationCtx,
  operationId: Id<'agentFileOperations'>,
  targets: OperationTargets,
) {
  for (const { agentId, homeId } of targets.agents) {
    if (homeId) await ctx.db.patch(homeId, { operationId })
    await ctx.db.patch(agentId, { fileOperationId: operationId })
  }
  if (targets.skillId) await ctx.db.patch(targets.skillId, { operationId })
}

/** Releases only claims still belonging to this operation. */
export async function releaseOperation(ctx: MutationCtx, op: Operation) {
  for (const homeId of new Set([op.homeId, op.destinationHomeId])) {
    if (homeId) await releaseHome(ctx, homeId, op._id)
  }

  for (const id of [op.agentId, op.duplicateId]) {
    if (!id) continue
    const agent = await ctx.db.get(id)
    if (!agent || agent.fileOperationId !== op._id) continue
    if (agent.homeId) await releaseHome(ctx, agent.homeId, op._id)
    await ctx.db.patch(id, { fileOperationId: undefined })
  }

  if (op.skillId && (await holdsSkillReservation(ctx, op.skillId, op._id)))
    await ctx.db.patch(op.skillId, { operationId: undefined })
}

/** Schedules execution and its recovery check together. */
export async function scheduleOperation(
  ctx: MutationCtx,
  operationId: Id<'agentFileOperations'>,
) {
  await ctx.scheduler.runAfter(0, internal.actions.skills._run, { operationId })
  await ctx.scheduler.runAfter(10 * 60_000, internal.skills._watchdog, { operationId }) // prettier-ignore
}
