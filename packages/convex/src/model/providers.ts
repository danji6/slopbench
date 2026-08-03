import { MAX_PROVIDERS, MAX_PROVIDER_MODELS } from '@sb/core/limits'
import type { ModelEntry, ModelProviderConfig } from '@sb/core/types'

import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import * as Credentials from './credentials'

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
    enabled: provider.enabled,
    models: provider.models,
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
    enabled: provider.enabled,
    models: provider.models,
  }))
}

export async function create(
  ctx: AuthMutationCtx,
  {
    key,
    baseURL,
    enabled,
    models,
  }: {
    key: string
    baseURL?: string
    enabled: boolean
    models: ModelEntry[]
  },
) {
  const providers = await listProviders(ctx, ctx.userId)
  if (providers.length >= MAX_PROVIDERS) {
    error(`At most ${MAX_PROVIDERS} providers`, 400)
  }
  if (providers.some((provider) => provider.key === key)) {
    error('Duplicate provider', 409)
  }
  assertModelsWithinCap(models)

  return ctx.db.insert('modelProviders', {
    ownerId: ctx.userId,
    key,
    baseURL,
    enabled,
    models,
    order: providers.length,
  })
}

export async function update(
  ctx: AuthMutationCtx,
  {
    providerId,
    ...patch
  }: {
    providerId: Id<'modelProviders'>
    baseURL?: string
    enabled?: boolean
    models?: ModelEntry[]
  },
) {
  const provider = await requireOwned(ctx, providerId)
  if (patch.models) assertModelsWithinCap(patch.models)
  await ctx.db.patch(provider._id, patch)
}

export type ModelProviderInput = {
  key: string
  baseURL?: string
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
    error(`Providers limit exceeded ${MAX_PROVIDERS} providers`, 400)
  }

  const existing = await listProviders(ctx, ctx.userId)
  const byKey = new Map(existing.map((provider) => [provider.key, provider]))
  const seen = new Set<string>()

  for (const [order, input] of providers.entries()) {
    const { apiKey, ...fields } = input
    if (seen.has(fields.key)) continue
    seen.add(fields.key)
    assertModelsWithinCap(fields.models)

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
      enabled: provider.enabled,
      models: provider.models,
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
    error(`Models limit exceeded (${MAX_PROVIDER_MODELS})`, 400)
  }
}
