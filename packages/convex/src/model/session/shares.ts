import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import { generateId } from '../../lib/utils'
import { getMember, getMembership, requireOwner } from './memberships'

export async function list(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const member = await getMember(ctx, sessionId, ctx.userId)
  if (!member) return []
  if (member.membership.role !== 'owner') error('Forbidden', 403)
  return ctx.db
    .query('sessionShares')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
}

export async function createOrRotate(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireOwner(ctx, sessionId, ctx.userId)

  const existing = await ctx.db
    .query('sessionShares')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const share of existing) {
    if (!share.revokedAt)
      await ctx.db.patch(share._id, { revokedAt: Date.now() })
  }

  const token = generateId()
  const shareId = await ctx.db.insert('sessionShares', {
    sessionId,
    createdBy: ctx.userId,
    tokenHash: await hashToken(token),
  })

  return { shareId, token }
}

export async function revoke(
  ctx: AuthMutationCtx,
  {
    sessionId,
    shareId,
  }: {
    sessionId: Id<'sessions'>
    shareId: Id<'sessionShares'>
  },
) {
  await requireOwner(ctx, sessionId, ctx.userId)
  const share = await ctx.db.get(shareId)
  if (share?.sessionId === sessionId) {
    await ctx.db.patch(shareId, { revokedAt: Date.now() })
  }
}

export async function redeem(
  ctx: AuthMutationCtx,
  { token }: { token: string },
) {
  const tokenHash = await hashToken(token)

  const share = await ctx.db
    .query('sessionShares')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .unique()
  if (!share || share.revokedAt) return null

  const existing = await getMembership(ctx, share.sessionId, ctx.userId)

  if (!existing) {
    const session = await ctx.db.get(share.sessionId)
    await ctx.db.insert('userSessions', {
      sessionId: share.sessionId,
      userId: ctx.userId,
      role: 'member',
      lastMessageAt: session?.lastMessageAt,
      title: session?.title,
    })
  }

  return share.sessionId
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
