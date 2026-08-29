import type * as V from '@sb/convex/validators'
import type { Infer } from 'convex/values'

export const REASONING_TIERS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ReasoningTier = (typeof REASONING_TIERS)[number]

export type ReasoningEffort = 'none' | ReasoningTier | 'auto'

export type ModelReasoning =
  | { type: 'effort'; efforts: ReasoningTier[] }
  | { type: 'binary'; parameter: string }
  | { type: 'none' }

export type ModelSelection = Infer<typeof V.modelSelectionValidator>

export type ModelEntry = Infer<typeof V.modelEntryValidator>

export type ModelProviderConfig = Infer<typeof V.modelProviderValidator>

export type InferenceParameters = NonNullable<ModelEntry['inference']>

export type ContextOptions = {
  trimContext?: boolean
  contextWindow?: number
  outputTokens?: number
  shareUserDisplayNames?: boolean
  shareAgentDisplayNames?: boolean
  maskOtherAgents?: boolean
}
