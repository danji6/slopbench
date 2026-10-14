import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { InvalidateAgentHomeArgs } from '../../types'
import { getState, patchState } from '../session/state'
import { isRunningOperation, releaseOperation } from './lifecycle'

type FinishingHomeOperation = Doc<'agentFileOperations'> & {
  agentId: Id<'agents'>
}

export function isFinishingHomeOperation(
  operation: Doc<'agentFileOperations'> | null,
): operation is FinishingHomeOperation {
  return (
    isRunningOperation(operation) &&
    !!operation.agentId &&
    operation.finishingHome === true
  )
}

/** Restarts invalidation using the current operation's authoritative metadata. */
export async function scheduleHomeInvalidation(
  ctx: MutationCtx,
  operation: Doc<'agentFileOperations'>,
) {
  await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
    operationId: operation._id,
    attempt: operation.attempt ?? 0,
    cursor: null,
    previousPath: operation.previousHomePath,
  })
}

/** Revokes grants to the old home before allowing the agent to run with its new home. */
export async function invalidateHomeCaches(
  ctx: MutationCtx,
  args: InvalidateAgentHomeArgs,
) {
  const operation = await ctx.db.get(args.operationId)
  if (!isFinishingHomeOperation(operation)) return
  // Old scheduled jobs can request recovery, but cannot supply its path or cursor.
  if (args.attempt === undefined) {
    await scheduleHomeInvalidation(ctx, operation)
    return
  }
  if (args.attempt !== (operation.attempt ?? 0)) return
  await ctx.db.patch(operation._id, { updatedAt: Date.now() })
  await invalidatePage(ctx, operation, args.cursor)
}

async function invalidatePage(
  ctx: MutationCtx,
  operation: FinishingHomeOperation,
  cursor: InvalidateAgentHomeArgs['cursor'],
) {
  const rows = await ctx.db
    .query('sessionCache')
    .withIndex('by_agentId', (q) => q.eq('agentId', operation.agentId))
    .paginate({ cursor, numItems: 20 })

  for (const row of rows.page) {
    await revokeHomeApprovals(ctx, row.sessionId, operation.previousHomePath)
    // Revision invalidates this cache immediately; retain it until pagination finishes
  }
  if (!rows.isDone) {
    await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
      operationId: operation._id,
      attempt: operation.attempt ?? 0,
      cursor: rows.continueCursor,
      previousPath: operation.previousHomePath,
    })
    return
  }
  await releaseOperation(ctx, operation)
  await ctx.db.patch(operation._id, { status: 'done', updatedAt: Date.now() })
}

async function revokeHomeApprovals(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  previousPath?: string,
) {
  const state = await getState(ctx, sessionId)
  const previous = previousPath?.replace(/\\/g, '/')
  if (!previous || !state?.toolApprovals?.paths) return
  const paths = state.toolApprovals.paths.filter((entry) => {
    const normalized = entry.replace(/\\/g, '/')
    return normalized !== previous && !normalized.startsWith(`${previous}/`)
  })
  await patchState(ctx, sessionId, {
    toolApprovals: { ...state.toolApprovals, paths },
  })
}
