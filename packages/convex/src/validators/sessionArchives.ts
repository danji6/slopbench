import { v } from 'convex/values'

import {
  messageExtraValidator,
  messageMetaValidator,
  messageTypeValidator,
  roleValidator,
} from './messages'

export const sessionArchiveSenderSnapshotValidator = v.object({
  name: v.string(),
  avatarKey: v.optional(v.string()),
})

export const sessionArchiveAvatarValidator = v.object({
  key: v.string(),
  mediaType: v.string(),
  data: v.string(),
})

export const sessionArchiveMessageValidator = v.object({
  role: roleValidator,
  type: v.optional(messageTypeValidator),
  hidden: v.optional(v.boolean()),
  extra: v.optional(messageExtraValidator),
  parts: v.array(v.any()),
  senderSnapshot: v.optional(sessionArchiveSenderSnapshotValidator),
  metadata: v.optional(messageMetaValidator),
})

export const sessionArchiveValidator = v.object({
  version: v.literal(1),
  exportedAt: v.number(),
  avatars: v.optional(v.array(sessionArchiveAvatarValidator)),
  session: v.object({
    title: v.string(),
    messages: v.array(sessionArchiveMessageValidator),
  }),
})
