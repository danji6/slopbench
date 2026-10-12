import { internal } from '../../_generated/api'
import type { MutationCtx } from '../../_generated/server'
import type { InvalidateAgentHomeArgs } from '../../types'
import { getState, patchState } from '../session/state'
import { release } from './completion'

/** Revokes grants to the old home before allowing the agent to run with its new home. */
export async function invalidateHomeCaches(
  ctx: MutationCtx,
  args: InvalidateAgentHomeArgs,
) {
  const operation = await ctx.db.get(args.operationId)
  if (!operation?.agentId || operation.status !== 'running') return
  await ctx.db.patch(operation._id, { updatedAt: Date.now() })

  const rows = await ctx.db
    .query('sessionCache')
    .withIndex('by_agentId', (q) => q.eq('agentId', operation.agentId!))
    .paginate({ cursor: args.cursor, numItems: 20 })

  for (const row of rows.page) {
    const state = await getState(ctx, row.sessionId)
    const previous = args.previousPath?.replace(/\\/g, '/')
    if (previous && state?.toolApprovals?.paths) {
      const paths = state.toolApprovals.paths.filter((entry) => {
        const normalized = entry.replace(/\\/g, '/')
        return normalized !== previous && !normalized.startsWith(`${previous}/`)
      })
      await patchState(ctx, row.sessionId, {
        toolApprovals: { ...state.toolApprovals, paths },
      })
    }
    // Revision invalidates this cache immediately; retain it until pagination finishes
  }
  if (!rows.isDone) {
    await ctx.scheduler.runAfter(0, internal.skills._invalidateHomeCaches, {
      ...args,
      cursor: rows.continueCursor,
    })
    return
  }
  await release(ctx, operation._id)
  await ctx.db.patch(operation._id, { status: 'done', updatedAt: Date.now() })
}
