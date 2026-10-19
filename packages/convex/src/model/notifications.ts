import { approvalSummary } from '@sb/core/approval-presentation'
import {
  MAX_NOTIFICATION_PREVIEW_CHARS,
  MAX_READ_NOTIFICATIONS,
  MAX_UNREAD_NOTIFICATIONS,
} from '@sb/core/limits'
import type { AskToolInput } from '@sb/core/types'
import { isPendingAskPart } from '@sb/core/utils/ask'
import { isPendingToolApproval } from '@sb/core/utils/tool-parts'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type {
  NotificationApproval,
  NotificationApprovalAction,
  NotificationKind,
  NotificationRequest,
  NotificationStatus,
} from '../types'
import { getProcessingSegmentRow } from './messageContents'
import * as ApprovalNotifications from './notificationApprovals'
import { hasRequest, settleRequest } from './notificationRequests'

/** Denormalized activity snapshot persisted once per recipient. */
type NotificationEvent = {
  sessionId: Id<'sessions'>
  kind: NotificationKind
  actorName: string
  actorAvatarId?: Id<'avatars'>
  preview?: string
  sourceMessageId?: Id<'messages'>
  approval?: NotificationApproval
  request?: NotificationRequest
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
    approval?: NotificationApproval
    request?: NotificationRequest
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
    approval: args.approval,
    request: args.request,
  })
}

/** Creates an independent, described notification for each pending tool call. */
export async function notifyToolApprovals(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  sessionId: Id<'sessions'>,
) {
  const row = await getProcessingSegmentRow(ctx, stream)
  const messageId = stream.state.processingMessageId
  if (!row || !messageId) return

  for (const part of row.parts) {
    if (!isPendingToolApproval(part)) continue
    const call = part as typeof part & {
      toolCallId?: string
      input?: unknown
      approval?: { id?: string }
    }
    if (!call.toolCallId || !call.approval?.id) continue
    await notifyAgentEvent(ctx, {
      sessionId,
      agentId: stream.agentId,
      kind: 'approval_required',
      sourceMessageId: messageId,
      preview: notificationPreview(
        approvalSummary(call.type.slice(5), call.input),
        'Approval required',
      ),
      request: {
        streamId: stream._id,
        messageId,
        contentId: row._id,
        toolCallId: call.toolCallId,
      },
      approval: {
        streamId: stream._id,
        messageId,
        contentId: row._id,
        toolCallId: call.toolCallId,
        approvalId: call.approval.id,
      },
    })
  }
}

/** Creates one durable notification for each pending question invocation. */
export async function notifyQuestions(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  sessionId: Id<'sessions'>,
) {
  const row = await getProcessingSegmentRow(ctx, stream)
  const messageId = stream.state.processingMessageId
  if (!row || !messageId) return
  for (const part of row.parts) {
    if (!isPendingAskPart(part)) continue
    await notifyAgentEvent(ctx, {
      sessionId,
      agentId: stream.agentId,
      kind: 'input_required',
      sourceMessageId: messageId,
      preview: questionPreview(part.input),
      request: {
        streamId: stream._id,
        messageId,
        contentId: row._id,
        toolCallId: part.toolCallId,
      },
    })
  }
}

/** Keeps the question count visible even when the first question is long. */
function questionPreview(input: AskToolInput) {
  const questions = Array.isArray(input?.questions) ? input.questions : []
  const first = questions[0]?.question
  const preview = notificationPreview(
    typeof first === 'string' ? first : '',
    'Answer needed',
  )
  const suffix = questions.length > 1 ? ` (${questions.length} questions)` : ''
  return (
    preview.slice(0, MAX_NOTIFICATION_PREVIEW_CHARS - suffix.length) + suffix
  )
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
    const duplicate =
      event.request && (await hasRequest(ctx, member.userId, event.request))
    if (duplicate) continue
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
      approval: event.approval,
      request: event.request,
      requestState: event.request ? 'pending' : undefined,
      attention: event.request ? true : undefined,
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
  const rows = await ctx.db
    .query('notifications')
    .withIndex('by_recipientId_status_readAt', (q) =>
      q.eq('recipientId', ctx.userId).eq('status', status),
    )
    .order('desc')
    .collect()
  const ordinary = rows.filter((row) => !row.attention).slice(0, limit)
  return Promise.all(
    ordinary.map((row) => ApprovalNotifications.withApprovalActions(ctx, row)),
  )
}

/** Responds to the owned notification and records read state in one transaction. */
export async function respondApproval(
  ctx: AuthMutationCtx,
  {
    notificationId,
    action,
  }: {
    notificationId: Id<'notifications'>
    action: NotificationApprovalAction
  },
) {
  const notification = await requireOwned(ctx, notificationId)
  const status = await ApprovalNotifications.respondApproval(
    ctx,
    notification,
    action,
  )
  if (status === 'stale' && notification.request) {
    const stream = await ctx.db.get(notification.request.streamId)
    const expired = stream && stream.leaseExpiresAt < Date.now()
    await settleRequest(
      ctx,
      notification.request,
      expired ? 'expired' : 'unavailable',
    )
  }
  await markRead(ctx, { notificationId })
  return status
}

/** Marks one owned notification as read and enforces read retention. */
export async function markRead(
  ctx: AuthMutationCtx,
  { notificationId }: { notificationId: Id<'notifications'> },
) {
  const notification = await requireOwned(ctx, notificationId)
  if (notification.status === 'read' || notification.attention) return
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
      notification.status === 'read' ||
      notification.attention
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
    if (row.attention) continue
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
    if (row.status === 'unread' && !row.attention) {
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
    if (row.status === 'unread' && !row.attention) await ctx.db.delete(row._id)
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
  for (const row of rows) {
    if (!row.attention) await ctx.db.delete(row._id)
  }
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
  for (const row of rows
    .filter((row) => !row.attention)
    .slice(statusLimit(status))) {
    await ctx.db.delete(row._id)
  }
}

function statusLimit(status: NotificationStatus) {
  return status === 'unread' ? MAX_UNREAD_NOTIFICATIONS : MAX_READ_NOTIFICATIONS
}
