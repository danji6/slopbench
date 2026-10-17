'use node'
import type { DiscoveredModel } from '@sb/core/model-discovery'
import { v } from 'convex/values'

import type { Id } from '../_generated/dataModel'
import { action, internalAction } from '../_generated/server'
import type { DiscoveryResult } from '../model/provider/connectionActions'
import type { AccountStatus as ChatGPTStatus } from '../model/provider/openai/account'
import { detailTargetsArgsValidator } from '../validators/discovery'
import {
  previewDiscoveryArgsValidator,
  previewModelDetailsArgsValidator,
  removedConnectionArgsValidator,
} from '../validators/providers'

const connectionArgs = { providerId: v.id('modelProviders') }

export const discover = action({
  args: { ...connectionArgs, force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<DiscoveryResult> => {
    const service = await import('../model/provider/connectionActions')
    return service.discover(ctx, args)
  },
})

export const preview = action({
  args: previewDiscoveryArgsValidator.fields,
  handler: async (
    ctx,
    args,
  ): Promise<{
    previewId: Id<'discoveryPreviews'>
    models: DiscoveredModel[]
  }> => {
    const service = await import('../model/provider/connectionActions')
    return service.preview(ctx, args)
  },
})

export const status = action({
  args: connectionArgs,
  handler: async (ctx, args): Promise<ChatGPTStatus> => {
    const service = await import('../model/provider/connectionActions')
    return service.status(ctx, args)
  },
})

export const signIn = action({
  args: connectionArgs,
  handler: async (ctx, args): Promise<{ url: string; expiresAt: number }> => {
    const service = await import('../model/provider/connectionActions')
    return service.signIn(ctx, args)
  },
})

export const disconnect = action({
  args: connectionArgs,
  handler: async (ctx, args): Promise<{ revoked: boolean }> => {
    const service = await import('../model/provider/connectionActions')
    return service.disconnect(ctx, args)
  },
})

export const cancelSignIn = action({
  args: connectionArgs,
  handler: async (ctx, args): Promise<void> => {
    const service = await import('../model/provider/connectionActions')
    return service.cancelSignIn(ctx, args)
  },
})

export const remoteSetup = action({
  args: connectionArgs,
  handler: async (ctx, args): Promise<string> => {
    const service = await import('../model/provider/connectionActions')
    return service.remoteSetup(ctx, args)
  },
})

export const _disconnectRemoved = internalAction({
  args: removedConnectionArgsValidator.fields,
  handler: async (ctx, args): Promise<void> => {
    const service = await import('../model/provider/connectionActions')
    return service._disconnectRemoved(ctx, args)
  },
})

export const details = action({
  args: { ...connectionArgs, modelId: v.string() },
  handler: async (ctx, args): Promise<DiscoveredModel | null> => {
    const service = await import('../model/provider/connectionActions')
    return service.details(ctx, args)
  },
})

export const previewDetails = action({
  args: previewModelDetailsArgsValidator.fields,
  handler: async (ctx, args): Promise<DiscoveredModel | null> => {
    const service = await import('../model/provider/connectionActions')
    return service.previewDetails(ctx, args)
  },
})

export const _refreshDetails = internalAction({
  args: detailTargetsArgsValidator.fields,
  handler: async (ctx, args): Promise<void> => {
    const service = await import('../model/provider/connectionActions')
    return service.refreshDetails(ctx, args)
  },
})
