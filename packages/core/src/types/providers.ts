import type * as V from '@sb/convex/validators'
import type { Infer } from 'convex/values'

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'auto'

export type ModelEntry = Infer<typeof V.modelEntryValidator>

export type ModelProviderConfig = Infer<typeof V.modelProviderValidator>

export type InferenceParameters = {
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  repeatPenalty?: number
}

export type ContextOptions = {
  trimContext?: boolean
  contextWindow?: number
  outputTokens?: number
  shareUserDisplayNames?: boolean
  shareAgentDisplayNames?: boolean
  maskOtherAgents?: boolean
}
