import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { OperationAttemptArgs } from '../../types'
import { releaseHome } from './homes'

type Operation = Doc<'agentFileOperations'>
type AgentReservation = { agentId: Id<'agents'>; homeId: Id<'agentHomes'> }
export type OperationTargets = {
  agents: AgentReservation[]
  homes: Id<'agentHomes'>[]
  skillId?: Id<'skills'>
}

/** Resolves the reservations defined by a stored command. */
export function operationTargets(op: Operation): OperationTargets {
  const agents: AgentReservation[] = []
  const homes = new Set<Id<'agentHomes'>>()

  if ('agentId' in op) {
    agents.push({ agentId: op.agentId, homeId: op.homeId })
  }
  if ('homeId' in op) {
    homes.add(op.homeId)
  }
  if (op.kind === 'delete-library') {
    for (const homeId of op.homeIds ?? []) homes.add(homeId)
  }
  if (op.kind === 'duplicate') {
    agents.push({ agentId: op.duplicateId, homeId: op.destinationHomeId })
    homes.add(op.destinationHomeId)
  }
  if ('reservation' in op && op.reservation) {
    homes.add(op.reservation.homeId)
  }

  const skillId =
    op.kind === 'install'
      ? op.progress.skillId
      : 'skillId' in op
        ? op.skillId
        : undefined

  return { agents, homes: [...homes], skillId }
}

export function matchesAttempt(
  operation: Operation | null,
  attempt: number,
): operation is Operation {
  return operation?.attempt === attempt
}

/** Accepts callbacks only while their attempt still has work to finish. */
export function isActiveAttempt(
  operation: Operation | null,
  attempt: number,
): operation is Operation {
  if (!matchesAttempt(operation, attempt)) return false
  return operation.state.phase !== 'done' && operation.state.phase !== 'failed'
}

export function isExecutingOperation(
  operation: Operation | null,
  attempt: number,
): operation is Operation {
  return (
    matchesAttempt(operation, attempt) && operation.state.phase === 'executing'
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

/** Verifies every resource lease before an execution may start. */
export async function holdsOperationReservations(ctx: QueryCtx, op: Operation) {
  const targets = operationTargets(op)
  for (const { agentId, homeId } of targets.agents) {
    const agent = await ctx.db.get(agentId)
    if (agent?.fileOperationId !== op._id || agent.homeId !== homeId)
      return false
  }
  for (const id of targets.homes) {
    if ((await ctx.db.get(id))?.operationId !== op._id) return false
  }
  return !targets.skillId || holdsSkillReservation(ctx, targets.skillId, op._id)
}

/** Claims targets already resolved within the current mutation. */
export async function claimOperation(
  ctx: MutationCtx,
  operationId: Id<'agentFileOperations'>,
  targets: OperationTargets,
) {
  const homeIds = new Set([
    ...targets.homes,
    ...targets.agents.map((agent) => agent.homeId),
  ])
  for (const homeId of homeIds) {
    await ctx.db.patch(homeId, { operationId })
  }
  for (const { agentId } of targets.agents) {
    await ctx.db.patch(agentId, { fileOperationId: operationId })
  }
  if (targets.skillId) await ctx.db.patch(targets.skillId, { operationId })
}

/** Releases only claims still belonging to this operation. */
export async function releaseOperation(ctx: MutationCtx, op: Operation) {
  const targets = operationTargets(op)
  for (const homeId of targets.homes) await releaseHome(ctx, homeId, op._id)
  for (const { agentId } of targets.agents) {
    const agent = await ctx.db.get(agentId)
    if (agent?.fileOperationId !== op._id) continue
    if (agent.homeId) await releaseHome(ctx, agent.homeId, op._id)
    await ctx.db.patch(agentId, { fileOperationId: undefined })
  }
  if (!targets.skillId) return
  if (!(await holdsSkillReservation(ctx, targets.skillId, op._id))) return
  await ctx.db.patch(targets.skillId, { operationId: undefined })
}

/** Schedules an execution and recovery timer for the same attempt. */
export async function scheduleOperation(
  ctx: MutationCtx,
  args: OperationAttemptArgs,
) {
  await ctx.scheduler.runAfter(0, internal.actions.skills._run, args)
  await scheduleWatchdog(ctx, args)
}

export async function scheduleWatchdog(
  ctx: MutationCtx,
  args: OperationAttemptArgs,
  delay = 10 * 60_000,
) {
  await ctx.scheduler.runAfter(delay, internal.skills._watchdog, args)
}
