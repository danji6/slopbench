import { discoveredFields } from '@sb/core/discovered-model'
import type { DiscoveredModel } from '@sb/core/model-discovery'
import { providerFeatures } from '@sb/core/provider-registry'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { EnsureConnectionArgs, SaveProvidersArgs } from '../../types'
import * as Credentials from '../credentials'
import * as Providers from '../providers'
import { previewModels } from './previews'

type ConnectionInput = SaveProvidersArgs['connections'][number]

/** Creates the identity required by account sign-in. */
export async function ensureConnection(
  ctx: AuthMutationCtx,
  args: EnsureConnectionArgs,
) {
  if (!providerFeatures(args.key, args.auth).accountSignIn)
    error('Provider does not support account sign-in', 400)

  const rows = await Providers.listProviders(ctx, ctx.userId)
  const existing = rows.find((row) => row.identityKey === args.clientId)
  if (existing) {
    if (existing.key !== args.key || existing.auth !== args.auth)
      error('Connection identity changed', 409)
    return existing._id
  }

  const id = await Providers.create(ctx, {
    key: args.key,
    auth: args.auth,
    enabled: false,
    models: [],
  })
  await ctx.db.patch(id, { identityKey: args.clientId })
  return id
}

/** Applies an explicit change set atomically without replacing account identities. */
export async function saveProviders(
  ctx: AuthMutationCtx,
  args: SaveProvidersArgs,
) {
  assertUniqueConnections(args)

  for (const removed of args.removed) {
    const row = await Providers.requireOwned(ctx, removed.providerId)
    if ((row.configRevision ?? 0) !== removed.configRevision)
      error('Connection changed. Reload before saving.', 409)
    await Providers.remove(ctx, removed)
  }

  const result = []
  for (const input of args.connections)
    result.push(await saveConnection(ctx, input))

  return result
}

async function savedIdentity(ctx: AuthMutationCtx, input: ConnectionInput) {
  if (input.providerId) return Providers.requireOwned(ctx, input.providerId)
  const rows = await Providers.listProviders(ctx, ctx.userId)
  return rows.find((row) => row.identityKey === input.clientId)
}

async function saveConnection(ctx: AuthMutationCtx, input: ConnectionInput) {
  const {
    clientId,
    providerId: _id,
    previewId,
    configRevision,
    ...fields
  } = input

  const saved = await savedIdentity(ctx, input)
  const sameType =
    !saved ||
    (saved.key === fields.key &&
      (saved.auth ?? 'apiKey') === (fields.auth ?? 'apiKey'))
  if (!sameType) error('Connection type cannot be changed', 400)

  const apiKey =
    fields.apiKey ??
    (saved
      ? await Credentials.get(ctx, ctx.userId, 'provider', saved._id)
      : undefined)

  const models = previewId
    ? await previewModels(ctx, previewId, { ...fields, id: fields.key, apiKey })
    : undefined

  const id =
    saved?._id ??
    (await Providers.create(ctx, {
      ...fields,
      models: models ? [] : fields.models,
    }))

  const { key: _, auth: _auth, ...patch } = fields
  await Providers.update(
    ctx,
    {
      ...patch,
      models: models
        ? mergePreview(fields.models, models, saved?.models ?? [])
        : fields.models,
      providerId: id,
      configRevision: saved ? (configRevision ?? 0) : 0,
    },
    models,
  )
  if (!saved) await ctx.db.patch(id, { identityKey: clientId })
  if (previewId) await publishPreview(ctx, id, previewId)
  const row = await ctx.db.get(id)

  return { clientId, providerId: id, configRevision: row!.configRevision ?? 0 }
}

async function publishPreview(
  ctx: AuthMutationCtx,
  providerId: Id<'modelProviders'>,
  previewId: Id<'discoveryPreviews'>,
) {
  await ctx.db.patch(providerId, {
    discoveryGeneration: previewId,
    discoveredAt: Date.now(),
    discoveryBlocked: undefined,
    discoveryRetryAt: undefined,
    discoveryRateLimitedUntil: undefined,
    discoveryFailures: undefined,
  })

  const rows = await ctx.db
    .query('modelCatalog')
    .withIndex('by_generation', (q) => q.eq('generation', previewId))
    .collect()
  for (const row of rows)
    await ctx.db.patch(row._id, { connectionId: providerId })

  await ctx.db.delete(previewId)
  await ctx.scheduler.runAfter(0, internal.providers._cleanupCatalog, { providerId }) // prettier-ignore
}

function assertUniqueConnections(args: SaveProvidersArgs) {
  const ids = args.connections.flatMap((row) => row.providerId ? [row.providerId] : []) // prettier-ignore
  const clientIds = args.connections.map((row) => row.clientId)
  const removed = args.removed.map((row) => row.providerId)

  const duplicateIdentity =
    new Set(ids).size !== ids.length ||
    new Set(clientIds).size !== clientIds.length

  const duplicateRemoval =
    new Set(removed).size !== removed.length ||
    ids.some((id) => removed.includes(id))

  if (duplicateIdentity || duplicateRemoval)
    error('Duplicate connection in save', 400)
}

function mergePreview(
  models: ConnectionInput['models'],
  catalog: DiscoveredModel[],
  previous: ConnectionInput['models'],
) {
  return models.map((model) => {
    if (model.source !== 'discovered') return model
    const discovered = catalog.find((row) => row.id === model.id)
    if (!discovered) {
      const configured = previous.some(
        (row) => row.id === model.id && row.source === 'discovered',
      )
      if (!configured) error('Model is not in this discovery preview', 400)
      return { ...model, available: false }
    }
    return { ...model, ...discoveredFields(discovered), available: true }
  })
}
