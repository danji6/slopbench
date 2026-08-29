import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import type { AuthMutationCtx } from './functions'
import * as Providers from './model/providers'
import * as SessionModels from './model/session/models'
import * as V from './validators/args'

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

export const replaceAll = authMutation({
  args: V.replaceModelProvidersArgsValidator.fields,
  handler: async (ctx: AuthMutationCtx, args) => {
    await Providers.replaceAll(ctx, args)
    await SessionModels.refreshForOwner(ctx, ctx.userId)
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
