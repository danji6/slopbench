import type { DiscoveredModel } from './model-discovery'
import type { ModelEntry } from './types/providers'

export function discoveredFields(model?: DiscoveredModel) {
  return {
    discoveredLabel: model?.label,
    discoveredContextWindow: model?.contextWindow,
    discoveredReasoning: model?.reasoning,
    discoveredOutputLimit: model?.outputLimit,
    discoveredParameters: model?.supportedParameters,
    discoveredInference: model?.inference,
  }
}

export function effectiveModel(model: ModelEntry): ModelEntry {
  return {
    ...model,
    label: model.label ?? model.discoveredLabel,
    contextWindow: model.contextWindow ?? model.discoveredContextWindow,
    reasoning: model.reasoning ?? model.discoveredReasoning,
    inference: { ...model.discoveredInference, ...model.inference },
  }
}
