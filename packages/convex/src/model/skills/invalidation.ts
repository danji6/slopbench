import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { InvalidateAgentHomeArgs } from '../../types'
import { getState, patchState } from '../session/state'
import { finishOperation } from './completion'
import { matchesAttempt } from './lifecycle'
import { scheduleCleanup } from './removal'

type FinishingHomeOperation = Extract<
  Doc<'agentFileOperations'>,
  { kind: 'home' | 'detach' }
> & {
  state: { phase: 'invalidating'; previousPath?: string }
}

export function isInvalidatingHomeOperation(
  operation: Doc<'agentFileOperations'> | null,
): operation is FinishingHomeOperation {
  return (
    !!operation &&
    (operation.kind === 'home' || operation.kind === 'detach') &&
    operation.state.phase === 'invalidating'
  )
}

/** Restarts invalidation using the current operation's authoritative metadata. */
export async function scheduleHomeInvalidation(
  ctx: MutationCtx,
  operation: FinishingHomeOperation,
) {
  await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
    operationId: operation._id,
    attempt: operation.attempt,
    cursor: null,
  })
}

/** Revokes grants to the old home before allowing the agent to run with its new home. */
export async function invalidateHomeCaches(
  ctx: MutationCtx,
  args: InvalidateAgentHomeArgs,
) {
  const operation = await ctx.db.get(args.operationId)
  if (!isInvalidatingHomeOperation(operation)) return
  if (!matchesAttempt(operation, args.attempt)) return
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
    await revokeHomeApprovals(ctx, row.sessionId, operation.state.previousPath)
    // Revision invalidates this cache immediately; retain it until pagination finishes
  }
  if (!rows.isDone) {
    await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
      operationId: operation._id,
      attempt: operation.attempt,
      cursor: rows.continueCursor,
    })
    return
  }
  if (operation.kind === 'detach' && operation.removeFolder) {
    await ctx.db.patch(operation._id, {
      state: { phase: 'cleaning' },
      updatedAt: Date.now(),
    })
    await scheduleCleanup(ctx, {
      operationId: operation._id,
      attempt: operation.attempt,
    })
    return
  }
  await finishOperation(ctx, operation)
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
