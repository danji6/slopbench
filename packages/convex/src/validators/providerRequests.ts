import { v } from 'convex/values'

export const providerContinuityValueValidator = v.object({
  token: v.string(),
  authRevision: v.string(),
})

export const providerContinuityScopeValidator = v.object({
  providerId: v.string(),
  ownerId: v.string(),
  connectionId: v.string(),
  model: v.string(),
  cacheKeyHash: v.string(),
  messageId: v.id('messages'),
})

export const providerContinuityValidator = v.object({
  scope: providerContinuityScopeValidator,
  value: v.optional(providerContinuityValueValidator),
})

export const cacheDiagnosticValidator = v.object({
  id: v.string(),
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  generation: v.number(),
  attempt: v.number(),
  startedAt: v.number(),
  headersAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  gapMs: v.optional(v.number()),
  firstInTurn: v.boolean(),
  resetReason: v.string(),
  previousRequestId: v.optional(v.string()),
  requestHash: v.string(),
  cacheKeyHash: v.string(),
  instructionsHash: v.string(),
  toolsHash: v.string(),
  configurationHash: v.string(),
  inputHash: v.string(),
  inputItems: v.number(),
  prefixMatch: v.optional(
    v.union(v.literal('match'), v.literal('shortened'), v.literal('changed')),
  ),
  continuityAvailable: v.boolean(),
  continuitySent: v.optional(v.boolean()),
  continuityReturned: v.optional(v.boolean()),
  continuityConflict: v.optional(v.boolean()),
  invalidContinuity: v.optional(v.boolean()),
  authReset: v.optional(v.boolean()),
  status: v.optional(v.number()),
  upstreamRequestId: v.optional(v.string()),
  responseId: v.optional(v.string()),
  requestedModel: v.string(),
  reportedModel: v.optional(v.string()),
  rawInputTokens: v.optional(v.number()),
  rawCacheReadTokens: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()),
  usageSavedAt: v.optional(v.number()),
  outcome: v.union(
    v.literal('pending'),
    v.literal('streaming'),
    v.literal('completed'),
    v.literal('http_error'),
    v.literal('stream_error'),
    v.literal('aborted'),
    v.literal('transport_error'),
  ),
})
