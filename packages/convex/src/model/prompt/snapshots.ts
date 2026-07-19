import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { SavePromptSnapshotArgs } from '../../types'
import type { WirePromptItem } from './prompts'

/**
 * Frozen results of dynamic prompt evaluation:
 * - Row absence means the prompt needs re-evaluation.
 * - Mode flips never re-evaluate and the plan mode framing block is frozen
 *   separately (lazily, on the first plan mode invoke).
 * - `getVar()` inside a snapshot reads the environment as of snapshot time.
 */
export async function getBySessionAgent(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  agentId: Id<'agents'>,
) {
  return ctx.db
    .query('promptSnapshots')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', sessionId).eq('agentId', agentId),
    )
    .unique()
}

/** Upsert. First eval writes `items`; a first plan invoke patches `planItems`. */
export async function _save(ctx: MutationCtx, args: SavePromptSnapshotArgs) {
  const existing = await getBySessionAgent(ctx, args.sessionId, args.agentId)
  const capturedAt = Date.now()

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...(args.items && { items: args.items }),
      ...(args.planItems && { planItems: args.planItems }),
      capturedAt,
    })
    return existing._id
  }

  return ctx.db.insert('promptSnapshots', {
    sessionId: args.sessionId,
    agentId: args.agentId,
    items: args.items ?? [],
    planItems: args.planItems,
    capturedAt,
  })
}

/** Drops every snapshot of the session, scheduling a full re-evaluation. */
export async function removeForSession(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const rows = await ctx.db
    .query('promptSnapshots')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}

export type SnapshotPatch = {
  items?: WirePromptItem[]
  planItems?: WirePromptItem[]
}

export type SnapshotEvalPlan = {
  /** Items that still need sidecar evaluation (empty when fully frozen). */
  evalItems: WirePromptItem[]
  /** What to persist after eval; null when the snapshot is already complete. */
  snapshotPatch: (evaluated: WirePromptItem[]) => SnapshotPatch | null
  /** Frozen-first composition used to build the provider request. */
  requestItems: (evaluated: WirePromptItem[]) => WirePromptItem[]
}

/**
 * Decides which prompt blocks still need evaluation given the frozen
 * snapshot, and how to recompose the final invoke prompt list from frozen
 * and freshly evaluated parts.
 */
export function planSnapshotEval({
  snapshot,
  planMode,
  planPrompts,
  prompts,
}: {
  snapshot: Pick<Doc<'promptSnapshots'>, 'items' | 'planItems'> | null
  planMode: boolean
  planPrompts: WirePromptItem[]
  prompts: WirePromptItem[]
}): SnapshotEvalPlan {
  const needBase = !snapshot
  const needPlan = planMode && !snapshot?.planItems
  const evalPlanPrompts = needPlan ? planPrompts : []

  const planBlock = (evaluated: WirePromptItem[]) => {
    if (!planMode) return []
    return needPlan
      ? evaluated.slice(0, evalPlanPrompts.length)
      : (snapshot?.planItems ?? [])
  }

  return {
    evalItems: [...evalPlanPrompts, ...(needBase ? prompts : [])],
    snapshotPatch: (evaluated) => {
      if (!needBase && !needPlan) return null
      return {
        ...(needBase && { items: evaluated.slice(evalPlanPrompts.length) }),
        ...(needPlan && {
          planItems: evaluated.slice(0, evalPlanPrompts.length),
        }),
      }
    },
    requestItems: (evaluated) => [
      ...planBlock(evaluated),
      ...(needBase
        ? evaluated.slice(evalPlanPrompts.length)
        : (snapshot?.items ?? [])),
    ],
  }
}
