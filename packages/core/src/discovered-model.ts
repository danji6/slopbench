import type { DiscoveredModel } from './model-discovery'
import type { ModelEntry } from './types/providers'

/** Extracts provider-reported defaults without catalog bookkeeping. */
export function modelMetadata(
  model: DiscoveredModel,
): ModelEntry['discovered'] {
  return {
    label: model.label,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
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
