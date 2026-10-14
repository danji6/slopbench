import { v } from 'convex/values'

export const reasoningTierValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('xhigh'),
  v.literal('max'),
)

export const modelReasoningValidator = v.union(
  v.object({
    type: v.literal('effort'),
    efforts: v.array(reasoningTierValidator),
  }),
  v.object({
    type: v.literal('binary'),
    parameter: v.string(),
  }),
  v.object({ type: v.literal('none') }),
)

export const inferenceParametersValidator = v.object({
  temperature: v.optional(v.number()),
  topP: v.optional(v.number()),
  frequencyPenalty: v.optional(v.number()),
  presencePenalty: v.optional(v.number()),
  repeatPenalty: v.optional(v.number()),
})

const modelSelectionFields = {
  id: v.string(),
  label: v.optional(v.string()),
  contextWindow: v.optional(v.number()),
  reasoning: v.optional(modelReasoningValidator),
  extraParameters: v.optional(v.string()),
}

export const modelSelectionValidator = v.object(modelSelectionFields)

export const modelEntryValidator = v.object({
  ...modelSelectionFields,
  inference: v.optional(inferenceParametersValidator),
})

/** A model provider joined with its credential. */
export const modelProviderValidator = v.object({
  id: v.string(),
  apiKey: v.optional(v.string()),
  baseURL: v.optional(v.string()),
  extraHeaders: v.optional(v.string()),
  enabled: v.boolean(),
  models: v.array(modelEntryValidator),
})

export const tokenUsageValidator = v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  totalTokens: v.number(),
})

export const reasoningEffortValidator = v.union(
  reasoningTierValidator,
  v.literal('auto'),
  v.literal('none'),
)

export const replaceModelProvidersArgsValidator = v.object({
  providers: v.array(
    v.object({
      key: v.string(),
      baseURL: v.optional(v.string()),
      extraHeaders: v.optional(v.string()),
      enabled: v.boolean(),
      models: v.array(modelEntryValidator),
      apiKey: v.optional(v.string()),
    }),
  ),
})

export const createModelProviderArgsValidator = v.object({
  key: v.string(),
  baseURL: v.optional(v.string()),
  extraHeaders: v.optional(v.string()),
  enabled: v.boolean(),
  models: v.array(modelEntryValidator),
})

export const updateModelProviderArgsValidator = v.object({
  providerId: v.id('modelProviders'),
  baseURL: v.optional(v.string()),
  extraHeaders: v.optional(v.string()),
  enabled: v.optional(v.boolean()),
  models: v.optional(v.array(modelEntryValidator)),
})

export const setModelInferenceArgsValidator = v.object({
  modelId: v.string(),
  inference: inferenceParametersValidator,
})

/** A model provider, without its credential. */
export const modelProviderSchema = v.object({
  ownerId: v.id('users'),
  /** The provider id, e.g. 'ollama'. */
  key: v.string(),
  baseURL: v.optional(v.string()),
  /** Additional HTTP headers, stored as serialized JSON. */
  extraHeaders: v.optional(v.string()),
  enabled: v.boolean(),
  models: v.array(modelEntryValidator),
  order: v.number(),
})
