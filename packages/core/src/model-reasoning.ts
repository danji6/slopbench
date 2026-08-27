import type {
  ModelReasoning,
  ReasoningEffort,
  ReasoningTier,
} from './types/providers'

export const DEFAULT_REASONING_TIERS: ReasoningTier[] = [
  'low',
  'medium',
  'high',
]

export const DEFAULT_BINARY_REASONING_PARAMETER = 'enable_thinking'

export function defaultModelReasoning(): ModelReasoning {
  return { type: 'effort', efforts: [...DEFAULT_REASONING_TIERS] }
}

export function normalizeBinaryReasoningParameter(
  reasoning: ModelReasoning | undefined,
  parameter?: string,
): ModelReasoning | undefined {
  if (
    reasoning?.type !== 'binary' ||
    reasoning.parameter !== DEFAULT_BINARY_REASONING_PARAMETER ||
    !parameter ||
    parameter === reasoning.parameter
  ) {
    return reasoning
  }
  return { ...reasoning, parameter }
}

export function normalizeReasoningEffort(
  effort: ReasoningEffort | undefined,
  reasoning: ModelReasoning,
): ReasoningEffort {
  const selected = effort ?? 'auto'
  if (reasoning.type === 'none') return 'none'
  if (reasoning.type === 'binary') return selected === 'none' ? 'none' : 'auto'
  if (selected === 'auto' || selected === 'none') return selected
  return reasoning.efforts.includes(selected) ? selected : 'auto'
}
