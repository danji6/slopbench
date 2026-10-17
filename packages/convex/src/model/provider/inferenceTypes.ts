import type { ModelReasoning, ReasoningEffort } from '@sb/core/types'
import type { LanguageModel } from 'ai'

export type InferenceInput = {
  providerId: string
  modelId: string
  baseURL?: string
  apiKey?: string
  reasoning?: ModelReasoning
  reasoningEffort?: ReasoningEffort
  requestFetch?: typeof fetch
}

export type InferenceAdapter = (
  input: InferenceInput,
) => Promise<LanguageModel> | LanguageModel
