import { v } from 'convex/values'

/** Activity kinds that can produce durable notifications. */
export const notificationKindValidator = v.union(
  v.literal('user_message'),
  v.literal('turn_completed'),
  v.literal('approval_required'),
  v.literal('input_required'),
  v.literal('turn_error'),
)

/** Inbox states supported by notification retention and ordering. */
export const notificationStatusValidator = v.union(
  v.literal('unread'),
  v.literal('read'),
)

/** A notification with denormalized display snapshots. */
export const notificationSchema = v.object({
  recipientId: v.id('users'),
  sessionId: v.id('sessions'),
  kind: notificationKindValidator,
  status: notificationStatusValidator,
  readAt: v.optional(v.number()),
  sessionTitle: v.string(),
  actorName: v.string(),
  actorAvatarId: v.optional(v.id('avatars')),
  preview: v.optional(v.string()),
  sourceMessageId: v.optional(v.id('messages')),
})
