import type { PaginationOptions } from 'convex/server'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { NotificationRequest, NotificationRequestState } from '../types'
import { withApprovalActions } from './notificationApprovals'

type PendingPageArgs = {
  paginationOpts: PaginationOptions
  state: 'pending' | 'expired'
}

/** Lists protected requests without applying ordinary inbox retention limits. */
export async function pendingPage(
  ctx: AuthQueryCtx,
  { paginationOpts, state }: PendingPageArgs,
) {
  const result = await ctx.db
    .query('notifications')
    .withIndex('by_recipientId_attention', (q) =>
      q
        .eq('recipientId', ctx.userId)
        .eq('attention', true)
        .eq('requestState', state),
    )
    .order('asc')
    .paginate(paginationOpts)
  return {
    ...result,
    page: await Promise.all(
      result.page.map((row) => withApprovalActions(ctx, row)),
    ),
  }
}

/** Counts the whole inbox independently of loaded pages and returns popup candidates. */
export async function summary(ctx: AuthQueryCtx) {
  const [attention, unread] = await Promise.all([
    attentionRows(ctx).collect(),
    ctx.db
      .query('notifications')
      .withIndex('by_recipientId_status_readAt', (q) =>
        q.eq('recipientId', ctx.userId).eq('status', 'unread'),
      )
      .collect(),
  ])

  const pending = attention.filter((row) => row.requestState === 'pending')

  const recent = [...pending]
    .sort(
      (a, b) => b._creationTime - a._creationTime || b._id.localeCompare(a._id),
    )
    .slice(0, 100)

  return {
    unreadCount:
      attention.length + unread.filter((row) => !row.attention).length,
    pendingCount: pending.length,
    activeIds: [...pending, ...unread.filter((row) => !row.attention)].map(
      (row) => row._id,
    ),
    recent: await Promise.all(
      recent.map((row) => withApprovalActions(ctx, row)),
    ),
  }
}

function attentionRows(ctx: AuthQueryCtx) {
  return ctx.db
    .query('notifications')
    .withIndex('by_recipientId_attention', (q) =>
      q.eq('recipientId', ctx.userId).eq('attention', true),
    )
}

/** Explicitly acknowledges an expired request; opening its chat is insufficient. */
export async function acknowledge(
  ctx: AuthMutationCtx,
  { notificationId }: { notificationId: Id<'notifications'> },
) {
  const row = await ctx.db.get(notificationId)
  if (!row || row.recipientId !== ctx.userId) error('Not found', 404)
  if (row.requestState !== 'expired') return
  await ctx.db.patch(row._id, {
    attention: false,
    status: 'read',
    readAt: Date.now(),
  })
}

/** Matches the exact processing segment and invocation behind a request. */
function sameInvocation(
  left: NotificationRequest | undefined,
  right: NotificationRequest,
) {
  return (
    left?.streamId === right.streamId &&
    left.messageId === right.messageId &&
    left.contentId === right.contentId &&
    left.toolCallId === right.toolCallId
  )
}

/** Prevents repeated parking from creating another copy for the same recipient. */
export async function hasRequest(
  ctx: MutationCtx,
  recipientId: Id<'users'>,
  request: NotificationRequest,
) {
  const rows = await forStream(ctx, request.streamId)
  return rows.some(
    (row) =>
      row.recipientId === recipientId && sameInvocation(row.request, request),
  )
}

/** Settles every recipient's copy of a particular invocation in the same transaction. */
export async function settleRequest(
  ctx: MutationCtx,
  target: NotificationRequest,
  state: Exclude<NotificationRequestState, 'pending'> = 'handled',
) {
  const rows = await forStream(ctx, target.streamId)
  for (const row of rows) {
    if (row.requestState !== 'pending' || !sameInvocation(row.request, target))
      continue
    await settle(ctx, row, state)
  }
}

/** Settles protected requests before their stream is stopped or removed. */
export async function settleStream(
  ctx: MutationCtx,
  streamId: Id<'streams'>,
  state: Exclude<NotificationRequestState, 'pending'>,
) {
  for (const row of await forStream(ctx, streamId)) {
    if (row.requestState === 'pending') await settle(ctx, row, state)
  }
}

function forStream(ctx: MutationCtx, streamId: Id<'streams'>) {
  return ctx.db
    .query('notifications')
    .withIndex('by_requestStreamId', (q) => q.eq('request.streamId', streamId))
    .collect()
}

async function settle(
  ctx: MutationCtx,
  row: Doc<'notifications'>,
  state: Exclude<NotificationRequestState, 'pending'>,
) {
  const expired = state === 'expired'
  await ctx.db.patch(row._id, {
    requestState: state,
    attention: expired,
    status: expired ? 'unread' : 'read',
    readAt: expired ? undefined : Date.now(),
  })
}
