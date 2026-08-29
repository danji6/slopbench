import { limitError } from '@sb/core/limit-errors'
import { MAX_PROVIDERS, MAX_PROVIDER_MODELS } from '@sb/core/limits'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'
import type { ModelEntry, ModelProviderConfig } from '@sb/core/types'

import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import * as Credentials from './credentials'
import { normalizeConfiguredReasoning } from './provider/known'

/** What the settings UI renders. */
export type ModelProviderView = Omit<ModelProviderConfig, 'apiKey'> & {
  _id: Id<'modelProviders'>
  hasKey: boolean
}

export async function list(ctx: AuthQueryCtx): Promise<ModelProviderView[]> {
  const providers = await listProviders(ctx, ctx.userId)
  const keys = await Credentials.map(ctx, ctx.userId, 'provider')

  return providers.map((provider) => ({
    _id: provider._id,
    id: provider.key,
    baseURL: provider.baseURL,
    extraHeaders: provider.extraHeaders,
    enabled: provider.enabled,
    models: normalizeProviderModels(provider.key, provider.models),
    hasKey: keys.has(provider.key),
  }))
}

/**
 * Providers joined with their credentials, for building provider clients.
 * Never expose this to a client as it carries API keys.
 */
export async function resolve(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
): Promise<ModelProviderConfig[]> {
  const providers = await listProviders(ctx, ownerId)
  const keys = await Credentials.map(ctx, ownerId, 'provider')

  return providers.map((provider) => ({
    id: provider.key,
    apiKey: keys.get(provider.key),
    baseURL: provider.baseURL,
    extraHeaders: provider.extraHeaders,
    enabled: provider.enabled,
    models: normalizeProviderModels(provider.key, provider.models),
  }))
}

export async function create(
  ctx: AuthMutationCtx,
  {
    key,
    baseURL,
    extraHeaders,
    enabled,
    models,
  }: {
    key: string
    baseURL?: string
    extraHeaders?: string
    enabled: boolean
    models: ModelEntry[]
  },
) {
  const providers = await listProviders(ctx, ctx.userId)
  if (providers.length >= MAX_PROVIDERS) {
    error(limitError('providers'), 400)
  }
  if (providers.some((provider) => provider.key === key)) {
    error('Duplicate provider', 409)
  }
  assertModelsWithinCap(models)
  parseProviderExtraHeaders(extraHeaders)

  return ctx.db.insert('modelProviders', {
    ownerId: ctx.userId,
    key,
    baseURL,
    extraHeaders,
    enabled,
    models: normalizeProviderModels(key, models),
    order: providers.length,
  })
}

type UpdateArgs = {
  providerId: Id<'modelProviders'>
  baseURL?: string
  extraHeaders?: string
  enabled?: boolean
  models?: ModelEntry[]
}

export async function update(
  ctx: AuthMutationCtx,
  { providerId, ...patch }: UpdateArgs,
) {
  const provider = await requireOwned(ctx, providerId)

  if (patch.models) assertModelsWithinCap(patch.models)
  if ('extraHeaders' in patch) parseProviderExtraHeaders(patch.extraHeaders)

  const normalizedModels = patch.models
    ? normalizeProviderModels(provider.key, patch.models)
    : undefined

  const normalizedPatch = {
    ...patch,
    ...(normalizedModels ? { models: normalizedModels } : {}),
  }

  await ctx.db.patch(provider._id, normalizedPatch)
}

type ModelInferenceArgs = {
  modelId: string
  inference: ModelEntry['inference']
}

/** Replaces the inference configuration for one owned model. */
export async function setModelInference(
  ctx: AuthMutationCtx,
  { modelId, inference }: ModelInferenceArgs,
) {
  const providers = await listProviders(ctx, ctx.userId)
  const provider = providers.find((row) =>
    row.models.some((model) => model.id.trim() === modelId),
  )
  if (!provider) error('Model not found', 404)

  const normalized = Object.keys(inference ?? {}).length ? inference : undefined
  const models = provider.models.map((model) =>
    model.id.trim() === modelId ? { ...model, inference: normalized } : model,
  )

  await ctx.db.patch(provider._id, { models })
}

export type ModelProviderInput = {
  key: string
  baseURL?: string
  extraHeaders?: string
  enabled: boolean
  models: ModelEntry[]
  /** `undefined` leaves the stored credential alone; `''` clears it. */
  apiKey?: string
}

/** Replaces the whole provider list from the settings form. */
export async function replaceAll(
  ctx: AuthMutationCtx,
  { providers }: { providers: ModelProviderInput[] },
) {
  if (providers.length > MAX_PROVIDERS) {
    error(limitError('providers'), 400)
  }

  const existing = await listProviders(ctx, ctx.userId)
  const byKey = new Map(existing.map((provider) => [provider.key, provider]))
  const seen = new Set<string>()

  for (const [order, input] of providers.entries()) {
    const { apiKey, ...rawFields } = input
    const fields = {
      ...rawFields,
      models: normalizeProviderModels(rawFields.key, rawFields.models),
    }
    if (seen.has(fields.key)) continue
    seen.add(fields.key)
    assertModelsWithinCap(fields.models)
    parseProviderExtraHeaders(fields.extraHeaders)

    const provider = byKey.get(fields.key)
    if (provider) {
      await ctx.db.patch(provider._id, { ...fields, order })
    } else {
      await ctx.db.insert('modelProviders', {
        ownerId: ctx.userId,
        ...fields,
        order,
      })
    }
    if (apiKey !== undefined) {
      await Credentials.set(ctx, ctx.userId, 'provider', fields.key, apiKey)
    }
  }

  for (const provider of existing) {
    if (seen.has(provider.key)) continue
    await Credentials.remove(ctx, ctx.userId, 'provider', provider.key)
    await ctx.db.delete(provider._id)
  }
}

/** Pass an empty string to clear it. */
export async function setApiKey(
  ctx: AuthMutationCtx,
  { providerId, apiKey }: { providerId: Id<'modelProviders'>; apiKey: string },
) {
  const provider = await requireOwned(ctx, providerId)
  await Credentials.set(ctx, ctx.userId, 'provider', provider.key, apiKey)
}

export async function remove(
  ctx: AuthMutationCtx,
  { providerId }: { providerId: Id<'modelProviders'> },
) {
  const provider = await requireOwned(ctx, providerId)
  await Credentials.remove(ctx, ctx.userId, 'provider', provider.key)
  await ctx.db.delete(provider._id)

  const remaining = await listProviders(ctx, ctx.userId)
  for (const [order, row] of remaining.entries()) {
    await ctx.db.patch(row._id, { order })
  }
}

export async function seed(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  providers: ModelProviderConfig[],
) {
  for (const [order, provider] of providers.entries()) {
    await ctx.db.insert('modelProviders', {
      ownerId,
      key: provider.id,
      baseURL: provider.baseURL,
      extraHeaders: provider.extraHeaders,
      enabled: provider.enabled,
      models: normalizeProviderModels(provider.id, provider.models),
      order,
    })
    if (provider.apiKey) {
      await Credentials.set(
        ctx,
        ownerId,
        'provider',
        provider.id,
        provider.apiKey,
      )
    }
  }
}

function listProviders(ctx: QueryCtx | MutationCtx, ownerId: Id<'users'>) {
  return ctx.db
    .query('modelProviders')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', ownerId))
    .order('asc')
    .collect()
}

async function requireOwned(
  ctx: AuthMutationCtx,
  providerId: Id<'modelProviders'>,
) {
  const provider = await ctx.db.get(providerId)
  if (!provider || provider.ownerId !== ctx.userId) error('Not found', 404)
  return provider
}

function assertModelsWithinCap(models: ModelEntry[]) {
  if (models.length > MAX_PROVIDER_MODELS) {
    error(limitError('providerModels'), 400)
  }
  for (const model of models) assertModelConfig(model)
}

function assertModelConfig(model: ModelEntry) {
  try {
    parseModelExtraParameters(model.extraParameters)
  } catch (err) {
    error(err instanceof Error ? err.message : 'Invalid extra parameters', 400)
  }

  if (model.reasoning?.type === 'binary' && !model.reasoning.parameter.trim()) {
    error('Binary thinking parameter cannot be empty', 400)
  }

  if (model.reasoning?.type === 'effort') {
    const unique = new Set(model.reasoning.efforts)
    if (unique.size !== model.reasoning.efforts.length) {
      error('Reasoning efforts cannot contain duplicates', 400)
    }
  }
}

function normalizeProviderModels(
  providerId: string,
  models: ModelEntry[],
): ModelEntry[] {
  return models.map((model) => {
    const reasoning = normalizeConfiguredReasoning(providerId, model.reasoning)
    const inference = Object.keys(model.inference ?? {}).length
      ? model.inference
      : undefined
    if (reasoning === model.reasoning && inference === model.inference) {
      return model
    }
    return { ...model, reasoning, inference }
  })
}
