import { v } from 'convex/values'

import {
  inferenceParametersValidator,
  modelReasoningValidator,
} from './providers'

export const discoveredModelValidator = v.object({
  id: v.string(),
  label: v.optional(v.string()),
  contextWindow: v.optional(v.number()),
  reasoning: v.optional(modelReasoningValidator),
  outputLimit: v.optional(v.number()),
  supportedParameters: v.optional(v.array(v.string())),
  inference: v.optional(inferenceParametersValidator),
  detailKey: v.optional(v.string()),
  detailsLoaded: v.optional(v.boolean()),
})

export const catalogRowSchema = v.object({
  connectionId: v.optional(v.id('modelProviders')),
  generation: v.string(),
  order: v.number(),
  model: discoveredModelValidator,
})

export const discoveryRunValidator = v.object({
  providerId: v.id('modelProviders'),
  ownerId: v.id('users'),
  revision: v.number(),
  generation: v.string(),
})

export const beginDiscoveryArgsValidator = v.object({
  ...discoveryRunValidator.fields,
  force: v.boolean(),
})

export const stageDiscoveryArgsValidator = v.object({
  ...discoveryRunValidator.fields,
  models: v.array(discoveredModelValidator),
  offset: v.number(),
})

export const finishDiscoveryArgsValidator = v.object({
  ...discoveryRunValidator.fields,
  failure: v.optional(v.string()),
  retryAfter: v.optional(v.number()),
  blocked: v.optional(v.boolean()),
})

export const discoveryPreviewSchema = v.object({
  ownerId: v.id('users'),
  fingerprint: v.string(),
  expiresAt: v.number(),
})
export const storePreviewArgsValidator = v.object({
  ownerId: v.id('users'),
  fingerprint: v.string(),
  models: v.array(discoveredModelValidator),
})

export const enrichModelArgsValidator = v.object({
  ...discoveryRunValidator.fields,
  model: discoveredModelValidator,
})

export const previewDetailArgsValidator = v.object({
  previewId: v.id('discoveryPreviews'),
  ownerId: v.id('users'),
  fingerprint: v.string(),
  model: discoveredModelValidator,
})

export const detailTargetsArgsValidator = v.object({
  ...discoveryRunValidator.fields,
  modelIds: v.array(v.string()),
})
