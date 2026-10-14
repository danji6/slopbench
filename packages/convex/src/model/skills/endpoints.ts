import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import type {
  CopySkillAssignmentsArgs,
  FileOperationArgs,
  InvalidateAgentHomeArgs,
  ReserveHomeArgs,
  SkillAssignmentsArgs,
} from '../../types'
import { assertAgentIdle, requireAdmin } from './access'
import * as Completion from './completion'
import { assertHomeDestination } from './destinations'
import { agentWithHome, homeMembers } from './homes'
import { invalidateHomeCaches as invalidateCaches } from './invalidation'
import * as Library from './library'
import * as Operations from './operations'

export const start = (ctx: AuthMutationCtx, args: FileOperationArgs) => {
  if (args.kind === 'duplicate' || args.kind === 'delete-home') {
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
  return op?.ownerId === ctx.userId
    ? {
        status: op.status,
        updatedAt: op.updatedAt,
        error: op.error,
        summary: op.importSummary,
      }
    : null
}

export const getOperation = async (
  ctx: QueryCtx,
  { operationId }: { operationId: Id<'agentFileOperations'> },
) => {
  const operation = await ctx.db.get(operationId)
  if (!operation) return null
  return {
    operation,
    agent: operation.agentId
      ? await agentWithHome(ctx, operation.agentId)
      : null,
    home: operation.homeId ? await ctx.db.get(operation.homeId) : null,
    destinationHome: operation.destinationHomeId
      ? await ctx.db.get(operation.destinationHomeId)
      : null,
    skill: operation.skillId ? await ctx.db.get(operation.skillId) : null,
  }
}

export const assignments = (ctx: QueryCtx, args: SkillAssignmentsArgs) =>
  Library.assignmentPage(
    ctx,
    args.agentId,
    args.paginationOpts,
    args.search?.trim().toLowerCase(),
  )

export const agent = (ctx: QueryCtx, { agentId }: { agentId: Id<'agents'> }) =>
  agentWithHome(ctx, agentId)

export const copyAssignments = async (
  ctx: MutationCtx,
  { operationId, ids, attempt }: CopySkillAssignmentsArgs,
) => {
  const op = await ctx.db.get(operationId)

  if (
    !op?.agentId ||
    op.status !== 'running' ||
    (attempt !== undefined && attempt !== op.attempt) ||
    ids.length > 20
  ) {
    error('Invalid assignment copy page', 409)
  }

  const target = op.duplicateId ? await ctx.db.get(op.duplicateId) : null
  const homeId = target?.homeId ?? op.destinationHomeId
  if (!homeId) error('Destination home not found', 409)

  for (const id of ids) {
    const row = await ctx.db.get(id)
    if (!row || row.ownerId !== op.ownerId || row.homeId !== op.homeId) {
      error('Assignment changed during copy', 409)
    }

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
  args: { operationId: Id<'agentFileOperations'> },
) => {
  const op = await ctx.db.get(args.operationId)
  if (op?.finishingHome && op.status === 'running') {
    await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
      operationId: op._id,
      cursor: null,
      previousPath: op.previousHomePath,
    })
    return
  }
  if (
    op &&
    ['queued', 'running'].includes(op.status) &&
    Date.now() - op.updatedAt >= 9 * 60_000
  ) {
    await Completion.fail(ctx, {
      ...args,
      message:
        'Filesystem operation interrupted. Retry to reconcile its saved progress.',
    })
  }
}

export const reserveDestination = async (
  ctx: MutationCtx,
  args: ReserveHomeArgs,
) => {
  const operation = await ctx.db.get(args.operationId)
  if (
    !operation?.agentId ||
    operation.status !== 'running' ||
    (args.attempt !== undefined && operation.attempt !== args.attempt)
  ) {
    error('Folder operation expired', 409)
  }

  if (operation.destinationHomeId) {
    const home = await ctx.db.get(operation.destinationHomeId)
    if (
      !home ||
      home.path !== args.path ||
      (home.operationId && home.operationId !== operation._id)
    ) {
      error('Destination changed during retry', 409)
    }

    for (const member of await homeMembers(ctx, home._id)) {
      if (member._id !== operation.agentId)
        await assertAgentIdle(
          ctx as AuthMutationCtx,
          member._id,
          operation.ownerId,
          operation._id,
        )
    }
    await ctx.db.patch(home._id, { operationId: operation._id })
    return { home, joined: operation.joinedHome ?? false }
  }

  let existing = await assertHomeDestination(ctx, operation.agentId, args.path)
  const source = operation.homeId ? await ctx.db.get(operation.homeId) : null
  if (
    !existing &&
    !operation.destination &&
    args.insideData &&
    source?.managed &&
    !source.path
  ) {
    existing = { ...source, path: args.path }
    await ctx.db.patch(source._id, { path: args.path })
  }

  if (existing?.operationId && existing.operationId !== operation._id)
    error('Destination folder is being updated', 409)
  if (args.insideData && !existing?.managed && operation.destination)
    error('Custom homes cannot overlap sidecar storage', 409)

  if (existing) {
    for (const member of await homeMembers(ctx, existing._id)) {
      if (member._id !== operation.agentId)
        await assertAgentIdle(
          ctx as AuthMutationCtx,
          member._id,
          operation.ownerId,
          operation._id,
        )
    }
  }

  const id =
    existing?._id ??
    (await ctx.db.insert('agentHomes', {
      ownerId: operation.ownerId,
      originAgentId: operation.agentId,
      managed: !operation.destination,
      path: args.path,
      revision: 0,
    }))

  await ctx.db.patch(id, { operationId: operation._id })
  await ctx.db.patch(operation._id, {
    destinationHomeId: id,
    joinedHome: !!existing && existing._id !== operation.homeId,
  })

  return {
    home: (await ctx.db.get(id))!,
    joined: !!existing && existing._id !== operation.homeId,
  }
}

export const invalidateHomeCaches = async (
  ctx: MutationCtx,
  args: InvalidateAgentHomeArgs,
) => {
  await invalidateCaches(ctx, args)
}
