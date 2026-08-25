import {
  MAX_NOTIFICATION_PREVIEW_CHARS,
  MAX_READ_NOTIFICATIONS,
  MAX_UNREAD_NOTIFICATIONS,
} from '@sb/core/limits'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { NotificationKind, NotificationStatus } from '../types'

/** Denormalized activity snapshot persisted once per recipient. */
type NotificationEvent = {
  sessionId: Id<'sessions'>
  kind: NotificationKind
  actorName: string
  actorAvatarId?: Id<'avatars'>
  preview?: string
  sourceMessageId?: Id<'messages'>
}

/** Normalizes notification previews to one bounded line. */
export function notificationPreview(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return (normalized || fallback).slice(0, MAX_NOTIFICATION_PREVIEW_CHARS)
}

/** Extracts visible text parts into a bounded completion preview. */
export function notificationPreviewFromParts(
  parts: unknown[],
  fallback = 'Turn completed',
): string {
  const text = parts
    .flatMap((part) => {
      const typed = part as { type?: unknown; text?: unknown }
      return typed.type === 'text' && typeof typed.text === 'string'
        ? [typed.text]
        : []
    })
    .join(' ')
  return notificationPreview(text, fallback)
}

/** Notifies every session member except the human sender. */
export async function notifyUserMessage(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'sessions'>
    senderId: Id<'users'>
    actorName: string
    actorAvatarId?: Id<'avatars'>
    preview: string
    sourceMessageId: Id<'messages'>
  },
) {
  await fanOut(
    ctx,
    {
      sessionId: args.sessionId,
      kind: 'user_message',
      actorName: args.actorName,
      actorAvatarId: args.actorAvatarId,
      preview: notificationPreview(args.preview, 'Sent a message'),
      sourceMessageId: args.sourceMessageId,
    },
    args.senderId,
  )
}

/** Notifies every member about visible root session agent activity. */
export async function notifyAgentEvent(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'sessions'>
    agentId: Id<'agents'>
    kind: Exclude<NotificationKind, 'user_message'>
    preview?: string
    sourceMessageId?: Id<'messages'>
  },
) {
  const [session, agent] = await Promise.all([
    ctx.db.get(args.sessionId),
    ctx.db.get(args.agentId),
  ])
  if (!session || session.parent || !agent) return

  await fanOut(ctx, {
    sessionId: args.sessionId,
    kind: args.kind,
    actorName: agent.name,
    actorAvatarId: agent.avatarId,
    preview: args.preview,
    sourceMessageId: args.sourceMessageId,
  })
}

/** Persists one notification snapshot for each eligible session member. */
async function fanOut(
  ctx: MutationCtx,
  event: NotificationEvent,
  excludedUserId?: Id<'users'>,
) {
  const session = await ctx.db.get(event.sessionId)
  if (!session) return

  const members = await ctx.db
    .query('userSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', event.sessionId))
    .collect()

  const sessionTitle =
    session.title || session.firstMessagePreview || 'New chat'

  for (const member of members) {
    if (member.userId === excludedUserId) continue
    await ctx.db.insert('notifications', {
      recipientId: member.userId,
      sessionId: event.sessionId,
      kind: event.kind,
      status: 'unread',
      sessionTitle,
      actorName: event.actorName,
      actorAvatarId: event.actorAvatarId,
      preview: event.preview,
      sourceMessageId: event.sourceMessageId,
    })
    await pruneStatus(ctx, member.userId, 'unread')
  }
}

/** Lists the current user's newest notifications for one inbox status. */
export async function list(
  ctx: AuthQueryCtx,
  { status }: { status: NotificationStatus },
) {
  const limit = statusLimit(status)
  return ctx.db
    .query('notifications')
    .withIndex('by_recipientId_status_readAt', (q) =>
      q.eq('recipientId', ctx.userId).eq('status', status),
    )
    .order('desc')
    .take(limit)
}

/** Marks one owned notification as read and enforces read retention. */
export async function markRead(
  ctx: AuthMutationCtx,
  { notificationId }: { notificationId: Id<'notifications'> },
) {
  const notification = await requireOwned(ctx, notificationId)
  if (notification.status === 'read') return
  await ctx.db.patch(notificationId, { status: 'read', readAt: Date.now() })
  await pruneStatus(ctx, ctx.userId, 'read')
}

/** Marks a bounded set of owned notifications as read. */
export async function markManyRead(
  ctx: AuthMutationCtx,
  { notificationIds }: { notificationIds: Id<'notifications'>[] },
) {
  const now = Date.now()
  for (const notificationId of notificationIds.slice(
    0,
    MAX_UNREAD_NOTIFICATIONS,
  )) {
    const notification = await ctx.db.get(notificationId)
    if (
      notification?.recipientId !== ctx.userId ||
      notification.status === 'read'
    ) {
      continue
    }
    await ctx.db.patch(notificationId, { status: 'read', readAt: now })
  }
  await pruneStatus(ctx, ctx.userId, 'read')
}

/** Marks every unread notification for the current user as read. */
export async function markAllRead(ctx: AuthMutationCtx) {
  const rows = await unreadForRecipient(ctx, ctx.userId)
  const now = Date.now()
  for (const row of rows) {
    await ctx.db.patch(row._id, { status: 'read', readAt: now })
  }
  await pruneStatus(ctx, ctx.userId, 'read')
}

/** Marks the current user's unread notifications for one session as read. */
export async function markSessionRead(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const rows = await forRecipientSession(ctx, ctx.userId, sessionId)
  const now = Date.now()
  for (const row of rows) {
    if (row.status === 'unread') {
      await ctx.db.patch(row._id, { status: 'read', readAt: now })
    }
  }
  await pruneStatus(ctx, ctx.userId, 'read')
}

/** Deletes notifications observed while their session was already focused. */
export async function discardSession(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const rows = await forRecipientSession(ctx, ctx.userId, sessionId)
  for (const row of rows) {
    if (row.status === 'unread') await ctx.db.delete(row._id)
  }
}

/** Clears the current user's read notification history. */
export async function clearRead(ctx: AuthMutationCtx) {
  const rows = await ctx.db
    .query('notifications')
    .withIndex('by_recipientId_status_readAt', (q) =>
      q.eq('recipientId', ctx.userId).eq('status', 'read'),
    )
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}

/** Removes all notifications belonging to a deleted session. */
export async function removeForSession(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const rows = await ctx.db
    .query('notifications')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}

/** Removes a former member's notifications for one session. */
export async function removeForMembership(
  ctx: MutationCtx,
  recipientId: Id<'users'>,
  sessionId: Id<'sessions'>,
) {
  const rows = await forRecipientSession(ctx, recipientId, sessionId)
  for (const row of rows) await ctx.db.delete(row._id)
}

/** Resolves a notification without revealing another user's rows. */
async function requireOwned(
  ctx: AuthMutationCtx,
  notificationId: Id<'notifications'>,
): Promise<Doc<'notifications'>> {
  const notification = await ctx.db.get(notificationId)
  if (!notification || notification.recipientId !== ctx.userId) {
    error('Not found', 404)
  }
  return notification
}

function unreadForRecipient(ctx: MutationCtx, recipientId: Id<'users'>) {
  return ctx.db
    .query('notifications')
    .withIndex('by_recipientId_status_readAt', (q) =>
      q.eq('recipientId', recipientId).eq('status', 'unread'),
    )
    .collect()
}

function forRecipientSession(
  ctx: MutationCtx,
  recipientId: Id<'users'>,
  sessionId: Id<'sessions'>,
) {
  return ctx.db
    .query('notifications')
    .withIndex('by_recipientId_sessionId', (q) =>
      q.eq('recipientId', recipientId).eq('sessionId', sessionId),
    )
    .collect()
}

/** Applies the retention limit for one notification status. */
async function pruneStatus(
  ctx: MutationCtx,
  recipientId: Id<'users'>,
  status: NotificationStatus,
) {
  const rows = await ctx.db
    .query('notifications')
    .withIndex('by_recipientId_status_readAt', (q) =>
      q.eq('recipientId', recipientId).eq('status', status),
    )
    .order('desc')
    .collect()
  for (const row of rows.slice(statusLimit(status))) {
    await ctx.db.delete(row._id)
  }
}

function statusLimit(status: NotificationStatus) {
  return status === 'unread' ? MAX_UNREAD_NOTIFICATIONS : MAX_READ_NOTIFICATIONS
}
