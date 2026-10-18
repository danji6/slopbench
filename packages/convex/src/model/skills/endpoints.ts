import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import type {
  CopySkillAssignmentsArgs,
  FileOperationArgs,
  InvalidateAgentHomeArgs,
  OperationAttemptArgs,
  ReserveHomeArgs,
  SkillAssignmentsArgs,
} from '../../types'
import { assertDestinationMembersIdle, requireAdmin } from './access'
import * as Completion from './completion'
import { assertHomeDestination } from './destinations'
import { agentWithHome } from './homes'
import {
  invalidateHomeCaches as invalidateCaches,
  isInvalidatingHomeOperation,
  scheduleHomeInvalidation,
} from './invalidation'
import * as Library from './library'
import {
  isActiveAttempt,
  isExecutingOperation,
  scheduleWatchdog,
} from './lifecycle'
import * as Operations from './operations'
import { scheduleCleanup } from './removal'

export const start = (ctx: AuthMutationCtx, args: FileOperationArgs) => {
  if (args.kind === 'duplicate') {
    error('Use the agent duplication command', 400)
  }
  return Operations.start(ctx, args)
}

export const operation = async (
  ctx: AuthQueryCtx,
  { operationId }: { operationId: Id<'agentFileOperations'> },
) => {
  requireAdmin(ctx)
  const op = await ctx.db.get(operationId)
  if (!op || op.ownerId !== ctx.userId) return null
  return {
    status: publicOperationStatus(op.state.phase),
    updatedAt: op.updatedAt,
    error: op.state.phase === 'failed' ? op.state.error : undefined,
    summary: op.kind === 'install' ? op.progress.summary : undefined,
  }
}

function publicOperationStatus(
  phase: Doc<'agentFileOperations'>['state']['phase'],
) {
  switch (phase) {
    case 'queued':
    case 'done':
    case 'failed':
      return phase
    default:
      return 'running' as const
  }
}

export const assignments = (ctx: QueryCtx, args: SkillAssignmentsArgs) =>
  Library.assignmentPage(
    ctx,
    args.agentId,
    args.paginationOpts,
    args.search?.trim().toLowerCase(),
    args.enabledOnly,
  )

export const agent = (ctx: QueryCtx, { agentId }: { agentId: Id<'agents'> }) =>
  agentWithHome(ctx, agentId)

export const copyAssignments = async (
  ctx: MutationCtx,
  { operationId, ids, attempt }: CopySkillAssignmentsArgs,
) => {
  const op = await ctx.db.get(operationId)

  if (!isExecutingOperation(op, attempt) || ids.length > 20) {
    error('Invalid assignment copy page', 409)
  }

  const copiesAssignments =
    op.kind === 'duplicate' || op.kind === 'home' || op.kind === 'ensure'
  if (!copiesAssignments) error('Invalid assignment copy command', 409)

  const homeId =
    op.kind === 'duplicate' ? op.destinationHomeId : op.reservation?.homeId
  if (!homeId) error('Destination home not found', 409)

  for (const id of ids) {
    const row = await ctx.db.get(id)
    const changed =
      !row || row.ownerId !== op.ownerId || row.homeId !== op.homeId
    if (changed) error('Assignment changed during copy', 409)

    const exists = await ctx.db
      .query('agentSkills')
      .withIndex('by_homeId_name', (q) =>
        q.eq('homeId', homeId).eq('name', row.name),
      )
      .first()

    if (!exists) {
      const { _id, _creationTime, ...fields } = row
      await ctx.db.insert('agentSkills', {
        ...fields,
        homeId,
      })
    }
  }
}

export const watchdog = async (
  ctx: MutationCtx,
  args: OperationAttemptArgs,
) => {
  const op = await ctx.db.get(args.operationId)
  if (!isActiveAttempt(op, args.attempt)) return
  const remaining = 9 * 60_000 - (Date.now() - op.updatedAt)
  if (remaining > 0) {
    await scheduleWatchdog(ctx, args, remaining)
    return
  }
  if (isInvalidatingHomeOperation(op)) {
    await scheduleHomeInvalidation(ctx, op)
    await scheduleWatchdog(ctx, args)
  } else if (op.state.phase === 'cleaning') {
    await scheduleCleanup(ctx, args)
    await scheduleWatchdog(ctx, args)
  } else {
    await Completion.fail(ctx, {
      ...args,
      message:
        'Filesystem operation interrupted. Retry to reconcile its saved progress.',
    })
  }
}

type HomeOperation = Extract<
  Doc<'agentFileOperations'>,
  { kind: 'home' | 'ensure' }
>

export const reserveDestination = async (
  ctx: MutationCtx,
  args: ReserveHomeArgs,
) => {
  const op = await ctx.db.get(args.operationId)
  const expired =
    !isExecutingOperation(op, args.attempt) ||
    (op.kind !== 'home' && op.kind !== 'ensure')
  if (expired) error('Folder operation expired', 409)
  if (op.reservation) return resumeDestination(ctx, op, args.path)
  const home = await resolveDestination(ctx, op, args)
  const joined = !!home && home._id !== op.homeId
  const target = home ?? (await createDestination(ctx, op, args.path))
  await ctx.db.patch(target._id, { operationId: op._id })
  await ctx.db.patch(op._id, { reservation: { homeId: target._id, joined } })
  return { home: target, joined }
}

async function resumeDestination(
  ctx: MutationCtx,
  op: HomeOperation,
  path: string,
) {
  const reservation = op.reservation
  if (!reservation) error('Destination was not reserved', 409)
  const home = await ctx.db.get(reservation.homeId)
  const changed =
    !home ||
    home.ownerId !== op.ownerId ||
    home.path !== path ||
    (home.operationId && home.operationId !== op._id)
  if (changed) error('Destination changed during retry', 409)
  await assertDestinationMembersIdle(ctx, home._id, op)
  await ctx.db.patch(home._id, { operationId: op._id })
  return { home, joined: reservation.joined }
}

async function resolveDestination(
  ctx: MutationCtx,
  op: HomeOperation,
  args: ReserveHomeArgs,
) {
  let existing = await assertHomeDestination(ctx, op.agentId, args.path)
  const source = await ctx.db.get(op.homeId)
  const initializing =
    !existing &&
    op.kind === 'ensure' &&
    args.insideData &&
    source?.managed &&
    !source.path
  if (initializing) {
    existing = { ...source, path: args.path }
    await ctx.db.patch(source._id, { path: args.path })
  }
  if (existing?.operationId && existing.operationId !== op._id)
    error('Destination folder is being updated', 409)
  if (args.insideData && !existing?.managed && op.kind === 'home')
    error('Custom homes cannot overlap sidecar storage', 409)
  if (existing) await assertDestinationMembersIdle(ctx, existing._id, op)
  return existing
}

async function createDestination(
  ctx: MutationCtx,
  op: HomeOperation,
  path: string,
) {
  const id = await ctx.db.insert('agentHomes', {
    ownerId: op.ownerId,
    originAgentId: op.agentId,
    managed: op.kind === 'ensure',
    path,
    revision: 0,
  })
  const home = await ctx.db.get(id)
  if (!home) error('Destination home no longer exists', 409)
  return home
}

export const invalidateHomeCaches = async (
  ctx: MutationCtx,
  args: InvalidateAgentHomeArgs,
) => {
  await invalidateCaches(ctx, args)
}
