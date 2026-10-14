import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { expireStream } from '../stream/expiry'
import { getSessionWithWorkspace } from './folderContext'

export async function getMembership(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
  userId: Id<'users'>,
) {
  return ctx.db
    .query('userSessions')
    .withIndex('by_sessionId_userId', (q) =>
      q.eq('sessionId', sessionId).eq('userId', userId),
    )
    .unique()
}

/** Counts session participants, split by kind. */
export async function countParticipants(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const [users, agents] = await Promise.all([
    ctx.db
      .query('userSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .collect(),
    ctx.db
      .query('sessionAgents')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .collect(),
  ])
  return { userCount: users.length, agentCount: agents.length }
}

export async function getMember(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
  userId: Id<'users'>,
) {
  const [session, membership] = await Promise.all([
    getSessionWithWorkspace(ctx, sessionId),
    getMembership(ctx, sessionId, userId),
  ])
  if (!session || !membership) return null
  return { session, membership }
}

export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
  userId: Id<'users'>,
) {
  const member = await getMember(ctx, sessionId, userId)
  if (!member) error('Not found', 404)
  return member
}

export async function requireOwner(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
  userId: Id<'users'>,
) {
  const result = await requireMember(ctx, sessionId, userId)
  if (result.membership.role !== 'owner') error('Forbidden', 403)
  return result
}

export function requireEnabled(session: {
  contextLock?: string
  settings?: { disabled?: boolean }
}) {
  if (session.contextLock) error('Folder sources are being updated', 409)
  if (session.settings?.disabled) error('Session is disabled', 409)
}

export async function getActiveStream(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const stream = await ctx.db
    .query('streams')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first()

  if (!stream) return null
  if (stream.leaseExpiresAt >= Date.now()) return stream
  if (!('scheduler' in ctx)) return stream

  await expireStream(ctx, stream)
  // Finalization may reserve a replacement (for example automatic compaction).
  return ctx.db
    .query('streams')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first()
}

export async function requireNonBlockingStream(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const stream = await getActiveStream(ctx, sessionId)
  if (stream?.command.kind === 'compact')
    error('Session is locked by a blocking operation', 409)
  return stream
}
