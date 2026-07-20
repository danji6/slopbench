import type { Doc } from '../../_generated/dataModel'
import type { PromptItem } from './prompts'

export type SnapshotPatch = {
  items?: PromptItem[]
  planItems?: PromptItem[]
}

export type SnapshotEvalPlan = {
  /** Items that still need sidecar evaluation (empty when fully frozen). */
  evalItems: PromptItem[]
  /** What to persist after eval; null when the snapshot is already complete. */
  snapshotPatch: (evaluated: PromptItem[]) => SnapshotPatch | null
  /** Frozen-first composition used to build the provider request. */
  requestItems: (evaluated: PromptItem[]) => PromptItem[]
}

/**
 * Decides which prompt blocks still need evaluation given the session cache,
 * and how to recompose the final invoke prompt list from cached and freshly
 * evaluated parts.
 */
export function planSnapshotEval({
  cache,
  planMode,
  planPrompts,
  prompts,
}: {
  cache: Pick<Doc<'sessionCache'>, 'items' | 'planItems'> | null
  planMode: boolean
  planPrompts: PromptItem[]
  prompts: PromptItem[]
}): SnapshotEvalPlan {
  const needBase = !cache
  const needPlan = planMode && !cache?.planItems
  const evalPlanPrompts = needPlan ? planPrompts : []

  const planBlock = (evaluated: PromptItem[]) => {
    if (!planMode) return []
    return needPlan
      ? evaluated.slice(0, evalPlanPrompts.length)
      : (cache?.planItems ?? [])
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
        : (cache?.items ?? [])),
    ],
  }
}
