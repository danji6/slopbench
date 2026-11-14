import type { DiscoveredModel } from './model-discovery'
import type { ModelEntry } from './types/providers'

export const DEFAULT_MODEL_CONTEXT_WINDOW = 256_000

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

/** Resolves model settings from explicit values, provider metadata, and defaults. */
export function effectiveModel(model: ModelEntry): ModelEntry {
  return {
    ...model,
    label: model.label ?? model.discovered?.label,
    contextWindow:
      model.contextWindow ??
      model.discovered?.contextWindow ??
      DEFAULT_MODEL_CONTEXT_WINDOW,
    reasoning: model.reasoning ?? model.discovered?.reasoning,
  }
}
