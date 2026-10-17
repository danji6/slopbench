import { effectiveModel } from '@sb/core/discovered-model'
import { limitError } from '@sb/core/limit-errors'
import { MAX_PROVIDERS } from '@sb/core/limits'
import type { DiscoveredModel } from '@sb/core/model-discovery'
import { parseModelReference } from '@sb/core/model-reference'
import { providerFeatures } from '@sb/core/provider-registry'
import type { ModelEntry, ModelProviderConfig } from '@sb/core/types'

import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { CreateModelProviderArgs, UpdateModelProviderArgs } from '../types'
import * as Credentials from './credentials'
import {
  normalizeProviderModels,
  validateCatalogModels,
  validateConnection,
} from './provider/connectionConfig'
import { cancelDiscovery } from './provider/discoveryState'
import { getProviderDefinition } from './provider/known'

/** What the settings UI renders. */
export type ModelProviderView = Omit<
  ModelProviderConfig,
  'apiKey' | 'connectionId' | 'ownerId'
> & {
  connectionId: Id<'modelProviders'>
  ownerId: Id<'users'>
  _id: Id<'modelProviders'>
  identityKey?: string
  hasKey: boolean
}

export async function list(ctx: AuthQueryCtx): Promise<ModelProviderView[]> {
  const providers = await listProviders(ctx, ctx.userId)
  const keys = await Credentials.map(ctx, ctx.userId, 'provider')

  return providers.map((provider) => ({
    _id: provider._id,
    identityKey: provider.identityKey,
    id: provider.key,
    connectionId: provider._id,
    ownerId: provider.ownerId,
    name: provider.name,
    auth: provider.auth ?? 'apiKey',
    configRevision: provider.configRevision ?? 0,
    baseURL: provider.baseURL,
    extraHeaders: provider.extraHeaders,
    enabled: provider.enabled,
    models: normalizeProviderModels(provider.key, provider.models),
    hasKey: keys.has(provider._id),
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
    connectionId: provider._id,
    ownerId: provider.ownerId,
    name: provider.name,
    auth: provider.auth ?? 'apiKey',
    configRevision: provider.configRevision ?? 0,
    apiKey: keys.get(provider._id),
    baseURL: provider.baseURL,
    extraHeaders: provider.extraHeaders,
    enabled: provider.enabled,
    models: normalizeProviderModels(provider.key, provider.models).map(
      effectiveModel,
    ),
  }))
}

export async function create(
  ctx: AuthMutationCtx,
  args: CreateModelProviderArgs,
) {
  const providers = await listProviders(ctx, ctx.userId)
  if (providers.length >= MAX_PROVIDERS) error(limitError('providers'), 400)

  const { apiKey, ...rawFields } = args
  const fields = {
    ...rawFields,
    baseURL: rawFields.baseURL || undefined,
    extraHeaders: rawFields.extraHeaders || undefined,
  }
  validateConnection(fields)
  if (fields.models.some((model) => model.source === 'discovered'))
    error('Save the connection, refresh discovery, then choose models', 400)

  const id = await ctx.db.insert('modelProviders', {
    ...fields,
    name: fields.name?.trim() || getProviderDefinition(fields.key).label,
    ownerId: ctx.userId,
    order: providers.length,
    configRevision: 0,
    models: normalizeProviderModels(fields.key, fields.models),
  })

  if (apiKey) {
    await Credentials.set(ctx, ctx.userId, 'provider', id, apiKey)
  }

  return id
}

export async function update(
  ctx: AuthMutationCtx,
  args: UpdateModelProviderArgs,
  preview?: DiscoveredModel[],
) {
  const { providerId, configRevision, apiKey, ...patch } = args
  const provider = await requireOwned(ctx, providerId)

  if ('baseURL' in patch) {
    patch.baseURL = patch.baseURL || undefined
  }
  if ('extraHeaders' in patch) {
    patch.extraHeaders = patch.extraHeaders || undefined
  }
  const connectionChanged =
    configRevision !== undefined && configRevision !== (provider.configRevision ?? 0) // prettier-ignore
  if (connectionChanged) {
    error('Connection changed. Reload before saving.', 409)
  }

  validateConnection({ ...provider, ...patch })

  const usesAccountSignIn = providerFeatures(provider.key, provider.auth).accountSignIn // prettier-ignore
  if (usesAccountSignIn && apiKey !== undefined) {
    error('This connection uses ChatGPT sign-in', 400)
  }

  const models = patch.models
    ? normalizeProviderModels(
        provider.key,
        preview
          ? patch.models
          : await validateCatalogModels(ctx, provider, patch.models),
      )
    : provider.models

  const networkChanged =
    apiKey !== undefined ||
    ('baseURL' in patch && patch.baseURL !== provider.baseURL) ||
    ('extraHeaders' in patch && patch.extraHeaders !== provider.extraHeaders)

  await ctx.db.patch(provider._id, {
    ...patch,
    name:
      'name' in patch
        ? patch.name?.trim() || getProviderDefinition(provider.key).label
        : provider.name,
    models,
    configRevision: (provider.configRevision ?? 0) + 1,
    discovery: cancelDiscovery(provider.discovery),
    ...(networkChanged && !preview ? invalidateConnectionCatalog(models) : {}),
  })

  if (apiKey !== undefined) {
    await Credentials.set(ctx, ctx.userId, 'provider', providerId, apiKey)
  }
}

function invalidateConnectionCatalog(models: ModelEntry[]) {
  return {
    discovery: undefined,
    models: models.map((model) =>
      model.source === 'discovered' ? { ...model, available: false } : model,
    ),
  }
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
  const reference = parseModelReference(modelId)
  const matches = providers.filter((row) =>
    row.models.some((model) => model.id.trim() === reference.modelId),
  )
  const provider = reference.connectionId
    ? matches.find((row) => row._id === reference.connectionId)
    : matches.length === 1
      ? matches[0]
      : undefined
  if (!provider) error('Model not found', 404)

  const normalized = Object.keys(inference ?? {}).length ? inference : undefined
  const models = provider.models.map((model) =>
    model.id.trim() === reference.modelId
      ? { ...model, inference: normalized }
      : model,
  )

  await ctx.db.patch(provider._id, {
    models,
    configRevision: (provider.configRevision ?? 0) + 1,
  })
}

/** Pass an empty string to clear it. */
export async function setApiKey(
  ctx: AuthMutationCtx,
  { providerId, apiKey }: { providerId: Id<'modelProviders'>; apiKey: string },
) {
  const provider = await requireOwned(ctx, providerId)
  await update(ctx, { providerId: provider._id, apiKey })
}

export async function remove(
  ctx: AuthMutationCtx,
  { providerId }: { providerId: Id<'modelProviders'> },
) {
  const provider = await requireOwned(ctx, providerId)
  await Credentials.remove(ctx, ctx.userId, 'provider', provider._id)
  await ctx.db.delete(provider._id)
  await ctx.scheduler.runAfter(0, internal.providers._cleanupCatalog, { providerId }) // prettier-ignore

  if (providerFeatures(provider.key, provider.auth).accountSignIn) {
    await ctx.scheduler.runAfter(
      0,
      internal.actions.providerConnections._disconnectRemoved,
      {
        ownerId: provider.ownerId,
        connectionId: provider._id,
        key: provider.key,
        auth: provider.auth,
      },
    )
  }

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
    const connectionId = await ctx.db.insert('modelProviders', {
      ownerId,
      key: provider.id,
      name: provider.name,
      auth: provider.auth ?? 'apiKey',
      configRevision: 0,
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
        connectionId,
        provider.apiKey,
      )
    }
  }
}

export function listProviders(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
) {
  return ctx.db
    .query('modelProviders')
    .withIndex('by_ownerId_order', (q) => q.eq('ownerId', ownerId))
    .order('asc')
    .collect()
}

export async function requireOwned(
  ctx: AuthMutationCtx | AuthQueryCtx,
  providerId: Id<'modelProviders'>,
) {
  const provider = await ctx.db.get(providerId)
  if (!provider || provider.ownerId !== ctx.userId) error('Not found', 404)
  return provider
}
