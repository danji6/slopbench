import { transitionActive } from '@sb/core/workspace/transition'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { removeForSession } from './cache'
import { sessionGroup } from './folderContext'
import { getState, patchState } from './state'

export async function sessionFamilies(ctx: QueryCtx, roots: Doc<'sessions'>[]) {
  const result = [...roots]
  const seen = new Set(roots.map((session) => session._id))

  for (let index = 0; index < result.length; index++) {
    const children = await ctx.db
      .query('sessions')
      .withIndex('by_parentSessionId', (q) =>
        q.eq('parent.sessionId', result[index]!._id),
      )
      .collect()
    for (const child of children) {
      if (seen.has(child._id)) error('Invalid session hierarchy', 409)
      seen.add(child._id)
      result.push(child)
    }
  }

  return result
}

export async function assertSessionsIdle(
  ctx: MutationCtx,
  sessions: Doc<'sessions'>[],
) {
  for (const session of sessions) {
    const stream = await ctx.db
      .query('streams')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
      .first()
    const pending = await ctx.db
      .query('messages')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
      .filter((q) => q.eq(q.field('status'), 'processing'))
      .first()
    if (stream || pending || transitionActive(session.contextLock)) {
      error(
        'Wait for sessions and their tools to finish before changing sources',
        409,
      )
    }
  }
}

export async function invalidateWorkspaces(
  ctx: MutationCtx,
  sessions: Doc<'sessions'>[],
) {
  for (const session of sessions) {
    const state = await getState(ctx, session._id)
    if (state?.toolApprovals?.paths || state?.pathApprovalRevision) {
      await patchState(ctx, session._id, {
        toolApprovals: { ...state.toolApprovals, paths: undefined },
        pathApprovalRevision: undefined,
      })
    }
    await removeForSession(ctx, session._id)
  }
}

/** Changes organizational placement without touching other members' folders. */
export async function placeSession(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  folderId?: Id<'sessionFolders'>,
  unpin?: boolean,
) {
  await ctx.db.patch(session._id, { folderId })
  const members = await ctx.db
    .query('userSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
    .collect()
  for (const member of members) {
    if (member.role !== 'owner') continue
    const pinned = unpin ? undefined : member.pinned
    await ctx.db.patch(member._id, {
      pinned,
      groupKey: sessionGroup(folderId, pinned),
    })
  }
}
