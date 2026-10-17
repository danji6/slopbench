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

export const providerAuthValidator = v.union(
  v.literal('apiKey'),
  v.literal('chatgpt'),
)

const connectionFields = {
  name: v.optional(v.string()),
  auth: v.optional(providerAuthValidator),
}

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
  discoveredOutputLimit: v.optional(v.number()),
  discoveredParameters: v.optional(v.array(v.string())),
  discoveredInference: v.optional(inferenceParametersValidator),
  discoveredLabel: v.optional(v.string()),
  discoveredContextWindow: v.optional(v.number()),
  discoveredReasoning: v.optional(modelReasoningValidator),
  source: v.optional(v.union(v.literal('manual'), v.literal('discovered'))),
  available: v.optional(v.boolean()),
  inference: v.optional(inferenceParametersValidator),
})

/** A model provider joined with its credential. */
export const modelProviderValidator = v.object({
  ...connectionFields,
  connectionId: v.optional(v.string()),
  ownerId: v.optional(v.string()),
  configRevision: v.optional(v.number()),
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

export const createModelProviderArgsValidator = v.object({
  ...connectionFields,
  apiKey: v.optional(v.string()),
  key: v.string(),
  baseURL: v.optional(v.string()),
  extraHeaders: v.optional(v.string()),
  enabled: v.boolean(),
  models: v.array(modelEntryValidator),
})

export const updateModelProviderArgsValidator = v.object({
  providerId: v.id('modelProviders'),
  name: v.optional(v.string()),
  configRevision: v.optional(v.number()),
  apiKey: v.optional(v.string()),
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
  ...connectionFields,
  configRevision: v.optional(v.number()),
  discoveryAttempt: v.optional(v.string()),
  discoveryGeneration: v.optional(v.string()),
  discoveryAttemptedAt: v.optional(v.number()),
  discoveryStartedAt: v.optional(v.number()),
  discoveredAt: v.optional(v.number()),
  discoveryError: v.optional(v.string()),
  discoveryFailures: v.optional(v.number()),
  discoveryRetryAt: v.optional(v.number()),
  discoveryRateLimitedUntil: v.optional(v.number()),
  discoveryBlocked: v.optional(v.boolean()),
  identityKey: v.optional(v.string()),
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

export const saveProvidersArgsValidator = v.object({
  connections: v.array(
    v.object({
      ...createModelProviderArgsValidator.fields,
      clientId: v.string(),
      providerId: v.optional(v.id('modelProviders')),
      configRevision: v.optional(v.number()),
      previewId: v.optional(v.id('discoveryPreviews')),
    }),
  ),
  removed: v.array(
    v.object({
      providerId: v.id('modelProviders'),
      configRevision: v.number(),
    }),
  ),
})
export const ensureConnectionArgsValidator = v.object({
  key: v.string(),
  auth: providerAuthValidator,
  clientId: v.string(),
})
export const previewDiscoveryArgsValidator = v.object({
  ...createModelProviderArgsValidator.fields,
  providerId: v.optional(v.id('modelProviders')),
})

export const previewModelDetailsArgsValidator = v.object({
  ...previewDiscoveryArgsValidator.fields,
  previewId: v.id('discoveryPreviews'),
  modelId: v.string(),
})
export const removedConnectionArgsValidator = v.object({
  ownerId: v.id('users'),
  connectionId: v.id('modelProviders'),
  key: v.string(),
  auth: v.optional(providerAuthValidator),
})
