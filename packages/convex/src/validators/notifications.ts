import { v } from 'convex/values'

export const notificationApprovalValidator = v.object({
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  contentId: v.id('messageContents'),
  toolCallId: v.string(),
  approvalId: v.string(),
})

export const notificationApprovalActionValidator = v.union(
  v.literal('allow'),
  v.literal('allow-session'),
  v.literal('deny'),
)

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

export const notificationRequestValidator = v.object({
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  contentId: v.id('messageContents'),
  toolCallId: v.string(),
})

export const notificationRequestStateValidator = v.union(
  v.literal('pending'),
  v.literal('handled'),
  v.literal('cancelled'),
  v.literal('expired'),
  v.literal('unavailable'),
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
  approval: v.optional(notificationApprovalValidator),
  request: v.optional(notificationRequestValidator),
  requestState: v.optional(notificationRequestStateValidator),
  attention: v.optional(v.boolean()),
})
