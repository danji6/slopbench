import { transitionActive } from '@sb/core/workspace/transition'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject } from '../../functions'
import type { FolderCancelArgs } from '../../types'

export function assertTransitionActive(token: string) {
  if (!transitionActive(token)) error('Folder update timed out, try again', 409)
}

export async function transitionUser(ctx: MutationCtx, subject: string) {
  const user = await findUserBySubject(ctx, subject)
  if (!user) error('Unauthorized', 401)
  return user
}

export function ownsTransition<
  T extends { ownerId: Id<'users'>; contextLock?: string },
>(row: T | null, ownerId: Id<'users'>, token: string): row is T {
  if (!row || row.ownerId !== ownerId) return false
  return row.contextLock === token
}

export function assertSessionsUnlocked(sessions: Doc<'sessions'>[]) {
  const moving = sessions.some((session) =>
    transitionActive(session.contextLock),
  )
  if (moving) error('Session is being moved', 409)
}

/** Releases only this transition's lock, including after its lease expires. */
export async function cancel(ctx: MutationCtx, args: FolderCancelArgs) {
  const user = await transitionUser(ctx, args.subject)
  const row = await ctx.db.get(args.target.id)
  if (!ownsTransition(row, user._id, args.token)) return
  await ctx.db.patch(args.target.id, { contextLock: undefined })
}
