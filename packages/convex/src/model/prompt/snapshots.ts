import type { Doc } from '../../_generated/dataModel'
import type { PromptItem } from './prompts'

export type SnapshotPatch = {
  items?: PromptItem[]
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
 * Decides whether the invoke prompts still need evaluation given the session
 * cache, and how to compose the final prompt list.
 */
export function planSnapshotEval({
  cache,
  prompts,
}: {
  cache: Pick<Doc<'sessionCache'>, 'items'> | null
  prompts: PromptItem[]
}): SnapshotEvalPlan {
  const needBase = !cache

  return {
    evalItems: needBase ? prompts : [],
    snapshotPatch: (evaluated) => (needBase ? { items: evaluated } : null),
    requestItems: (evaluated) => (needBase ? evaluated : (cache?.items ?? [])),
  }
}
