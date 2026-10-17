import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import type { AuthMutationCtx } from './functions'
import * as Catalog from './model/provider/catalog'
import * as Previews from './model/provider/previews'
import * as Save from './model/provider/save'
import * as Providers from './model/providers'
import * as SessionModels from './model/session/models'
import { storePreviewArgsValidator } from './validators/discovery'
import {
  beginDiscoveryArgsValidator,
  detailTargetsArgsValidator,
  discoveryRunValidator,
  enrichModelArgsValidator,
  finishDiscoveryArgsValidator,
  previewDetailArgsValidator,
  stageDiscoveryArgsValidator,
} from './validators/discovery'
import * as V from './validators/providers'

export const list = authQuery({
  args: {},
  handler: Providers.list,
})

export const create = authMutation({
  args: V.createModelProviderArgsValidator.fields,
  handler: async (ctx: AuthMutationCtx, args) => {
    const id = await Providers.create(ctx, args)
    await SessionModels.refreshForOwner(ctx, ctx.userId)
    return id
  },
})

export const update = authMutation({
  args: V.updateModelProviderArgsValidator.fields,
  handler: async (ctx: AuthMutationCtx, args) => {
    await Providers.update(ctx, args)
    if (args.models) await SessionModels.refreshForOwner(ctx, ctx.userId)
  },
})

export const setModelInference = authMutation({
  args: V.setModelInferenceArgsValidator.fields,
  handler: Providers.setModelInference,
})

export const setApiKey = authMutation({
  args: { providerId: v.id('modelProviders'), apiKey: v.string() },
  handler: Providers.setApiKey,
})

export const remove = authMutation({
  args: { providerId: v.id('modelProviders') },
  handler: async (ctx: AuthMutationCtx, args) => {
    await Providers.remove(ctx, args)
    await SessionModels.refreshForOwner(ctx, ctx.userId)
  },
})

export const get = authQuery({
  args: { providerId: v.id('modelProviders') },
  handler: async (ctx, { providerId }) => {
    await Providers.requireOwned(ctx, providerId)
    return (await Providers.list(ctx)).find(
      (provider) => provider._id === providerId,
    )!
  },
})

export const catalog = authQuery({
  args: { providerId: v.id('modelProviders') },
  handler: Catalog.catalog,
})

export const _connection = internalQuery({
  args: { providerId: v.id('modelProviders'), ownerId: v.id('users') },
  handler: async (ctx, { providerId, ownerId }) =>
    (await Providers.resolve(ctx, ownerId)).find(
      (provider) => provider.connectionId === providerId,
    ) ?? null,
})

export const _beginDiscovery = internalMutation({
  args: beginDiscoveryArgsValidator.fields,
  handler: Catalog.begin,
})

export const _stageDiscovery = internalMutation({
  args: stageDiscoveryArgsValidator.fields,
  handler: Catalog.stage,
})

export const _finishDiscovery = internalMutation({
  args: finishDiscoveryArgsValidator.fields,
  handler: async (ctx, args) => {
    const published = await Catalog.finish(ctx, args)
    if (published) await SessionModels.refreshForOwner(ctx, args.ownerId)
  },
})

export const _cleanupCatalog = internalMutation({
  args: { providerId: v.id('modelProviders') },
  handler: Catalog.cleanup,
})

export const _expireDiscovery = internalMutation({
  args: discoveryRunValidator.fields,
  handler: Catalog.expire,
})

export const save = authMutation({
  args: V.saveProvidersArgsValidator.fields,
  handler: async (ctx, args) => {
    const result = await Save.saveProviders(ctx, args)
    await SessionModels.refreshForOwner(ctx, ctx.userId)
    return result
  },
})

export const ensureConnection = authMutation({
  args: V.ensureConnectionArgsValidator.fields,
  handler: Save.ensureConnection,
})

export const _storePreview = internalMutation({
  args: storePreviewArgsValidator.fields,
  handler: Previews.storePreview,
})

export const _deletePreview = internalMutation({
  args: { previewId: v.id('discoveryPreviews') },
  handler: Previews.deletePreview,
})

export const owner = authQuery({ args: {}, handler: (ctx) => ctx.userId })

export const _resetDiscovery = internalMutation({
  args: { providerId: v.id('modelProviders') },
  handler: Catalog.reset,
})

export const previewCatalog = authQuery({
  args: { previewId: v.id('discoveryPreviews') },
  handler: Previews.catalog,
})

export const _enrichModel = internalMutation({
  args: enrichModelArgsValidator.fields,
  handler: async (ctx, args) => {
    const updated = await Catalog.enrich(ctx, args)
    if (updated) await SessionModels.refreshForOwner(ctx, args.ownerId)
  },
})

export const _enrichPreview = internalMutation({
  args: previewDetailArgsValidator.fields,
  handler: Previews.enrich,
})

export const _detailTargets = internalQuery({
  args: detailTargetsArgsValidator.fields,
  handler: Catalog.detailTargets,
})
