import { FALLBACK_DISPLAY_NAME } from '@sb/core/const'

import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import { getMember, requireMember } from './session/memberships'
import { getByOwnerId as getSettings } from './settings'

/** How long a typing heartbeat stays live before it is considered stale. */
export const TYPING_TTL_MS = 6000

async function getRow(
  ctx: AuthMutationCtx,
  sessionId: Id<'sessions'>,
  userId: Id<'users'>,
) {
  return ctx.db
    .query('typing')
    .withIndex('by_sessionId_userId', (q) =>
      q.eq('sessionId', sessionId).eq('userId', userId),
    )
    .unique()
}

export async function heartbeat(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireMember(ctx, sessionId, ctx.userId)

  const expiresAt = Date.now() + TYPING_TTL_MS
  const existing = await getRow(ctx, sessionId, ctx.userId)

  if (existing) {
    await ctx.db.patch(existing._id, { expiresAt })
  } else {
    await ctx.db.insert('typing', { sessionId, userId: ctx.userId, expiresAt })
  }
}

export async function clear(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const existing = await getRow(ctx, sessionId, ctx.userId)
  if (existing) await ctx.db.delete(existing._id)
}

export async function list(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  if (!(await getMember(ctx, sessionId, ctx.userId))) return []

  const now = Date.now()
  const rows = await ctx.db
    .query('typing')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  const active = rows.filter(
    (row) => row.expiresAt > now && row.userId !== ctx.userId,
  )

  return Promise.all(
    active.map(async (row) => {
      const settings = await getSettings(ctx, row.userId)
      return {
        userId: row.userId,
        name: settings?.displayName ?? FALLBACK_DISPLAY_NAME,
        expiresAt: row.expiresAt,
      }
    }),
  )
}

export async function _prune(ctx: MutationCtx) {
  const stale = await ctx.db
    .query('typing')
    .withIndex('by_expiresAt', (q) => q.lt('expiresAt', Date.now()))
    .collect()

  for (const row of stale) await ctx.db.delete(row._id)
}
