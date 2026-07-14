import { v } from 'convex/values'

import { internalMutation } from './_generated/server'
import { authQuery } from './functions'
import * as Avatars from './model/avatars'

export const getUrls = authQuery({
  args: { avatarId: v.id('avatars') },
  handler: (ctx, { avatarId }) => Avatars.getUrls(ctx, avatarId),
})

export const getUrlMap = authQuery({
  args: { ids: v.array(v.id('avatars')) },
  handler: Avatars.getUrlMap,
})

export const _create = internalMutation({
  args: { storageId: v.id('_storage'), thumbStorageId: v.id('_storage') },
  handler: (ctx, args) => Avatars._create(ctx, args),
})
