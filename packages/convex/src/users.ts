import { v } from 'convex/values'

import { internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Users from './model/users'

export const getProfile = authQuery({
  args: {},
  handler: Users.getProfile,
})

export const _getRoleBySubject = internalQuery({
  args: { subject: v.string() },
  handler: Users._getRoleBySubject,
})

export const ensureProfile = authMutation({
  args: {},
  handler: Users.ensureProfile,
})

export const updateProfile = authMutation({
  args: {
    displayName: v.optional(v.string()),
  },
  handler: Users.updateProfile,
})

export const clearAvatar = authMutation({
  args: {},
  handler: Users.clearAvatar,
})

export const generateAvatarUploadUrl = authMutation({
  args: {},
  handler: Users.generateAvatarUploadUrl,
})

export const confirmAvatarUpload = authMutation({
  args: {
    originalStorageId: v.id('_storage'),
    thumbStorageId: v.id('_storage'),
  },
  handler: Users.confirmAvatarUpload,
})
