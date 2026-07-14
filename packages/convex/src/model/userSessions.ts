import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import { getMember, getMembership, requireOwner } from './session/memberships'
import { getByOwnerId as getSettings } from './settings'
import { stopForUser } from './stream/lifecycle'

/** Keeps each member's denormalized title in sync with the session title. */
export async function syncTitle(
  ctx: AuthMutationCtx | MutationCtx,
  sessionId: Id<'sessions'>,
  title: string,
) {
  const members = await ctx.db
    .query('userSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const member of members) {
    if (member.title !== title) await ctx.db.patch(member._id, { title })
  }
}

export async function list(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  if (!(await getMember(ctx, sessionId, ctx.userId))) return []

  const userSessions = await ctx.db
    .query('userSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  return Promise.all(
    userSessions.map(async (membership) => ({
      membership,
      user: await ctx.db.get(membership.userId),
      settings: await getSettings(ctx, membership.userId),
    })),
  )
}

/** The current user's own membership row, for slow-mode cooldown tracking. */
export async function mine(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  return getMembership(ctx, sessionId, ctx.userId)
}

export async function remove(
  ctx: AuthMutationCtx,
  {
    sessionId,
    userId,
  }: {
    sessionId: Id<'sessions'>
    userId: Id<'users'>
  },
) {
  await requireOwner(ctx, sessionId, ctx.userId)

  if (userId === ctx.userId) {
    error('Cannot remove the session owner', 409)
  }

  const membership = await getMembership(ctx, sessionId, userId)
  if (!membership) return

  await stopForUser(ctx, userId)
  await ctx.db.delete(membership._id)
}
