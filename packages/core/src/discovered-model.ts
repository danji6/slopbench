import type { DiscoveredModel } from './model-discovery'
import type { ModelEntry } from './types/providers'

/** Extracts provider-reported defaults without catalog bookkeeping. */
export function modelMetadata(
  model: DiscoveredModel,
): ModelEntry['discovered'] {
  // Match Convex's serialized shape so metadata sync keeps saved forms clean.
  return {
    ...(model.label !== undefined ? { label: model.label } : {}),
    ...(model.contextWindow !== undefined
      ? { contextWindow: model.contextWindow }
      : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
  }
}

/** Resolves explicit settings before provider-reported defaults. */
export function effectiveModel(model: ModelEntry): ModelEntry {
  return {
    ...model,
    label: model.label ?? model.discovered?.label,
    contextWindow: model.contextWindow ?? model.discovered?.contextWindow,
    reasoning: model.reasoning ?? model.discovered?.reasoning,
  }
}
