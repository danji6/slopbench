import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { type AuthMutationCtx } from '../../functions'
import * as Attachments from '../attachments'
import * as Avatars from '../avatars'
import { deleteVersions } from '../messageContents'
import { cancelForSession as cancelScheduledEvents } from '../scheduledEvents'
import { remove as removeStream, stopForSession } from '../stream/lifecycle'
import { requireOwner } from './memberships'
import { getState } from './state'

// Left intentionally unwired for now
export async function removeAll(ctx: AuthMutationCtx) {
  const owned = await ctx.db
    .query('sessions')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ctx.userId))
    .collect()

  for (const session of owned) {
    // Children are cascade-deleted with their parent
    if (!session.parent) await remove(ctx, { sessionId: session._id })
  }
}

export async function remove(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireOwner(ctx, sessionId, ctx.userId)
  await stopForSession(ctx, sessionId)
  await cancelScheduledEvents(ctx, sessionId)

  // Read before the state row is deleted below
  const log = (await getState(ctx, sessionId))?.log

  const children = await ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) => q.eq('parent.sessionId', sessionId))
    .collect()

  for (const child of children) {
    await remove(ctx, { sessionId: child._id })
  }

  const sessionTables = [
    'userSessions',
    'sessionShares',
    'sessionAgents',
    'plans',
    'todos',
    'sessionCache',
    'sessionState',
    'typing',
    'shellJobs',
    'notifications',
  ] as const

  for (const table of sessionTables) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .collect()

    for (const row of rows) {
      await ctx.db.delete(row._id)
    }
  }

  const streams = await ctx.db
    .query('streams')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const stream of streams) {
    await removeStream(ctx, stream._id)
  }

  const attachments = await ctx.db
    .query('attachments')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const attachment of attachments) {
    await Attachments.removeAttachment(ctx, attachment)
  }

  await deleteStorageIfPresent(ctx, log)

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  const avatarIds = new Set(
    messages.flatMap((message) =>
      message.senderAvatarId ? [message.senderAvatarId] : [],
    ),
  )

  for (const message of messages) {
    await deleteVersions(ctx, message._id)
    await ctx.db.delete(message._id)
  }

  await ctx.db.delete(sessionId)

  for (const avatarId of avatarIds) {
    await Avatars.removeIfUnreferenced(ctx, avatarId)
  }
}

export async function deleteStorageIfPresent(
  ctx: MutationCtx,
  storageId: Id<'_storage'> | undefined,
) {
  if (storageId) await ctx.storage.delete(storageId).catch(() => {})
}
