import { transitionActive } from '@sb/core/workspace/transition'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject, requireRole } from '../../functions'
import type { FolderFinishArgs, FolderTransitionArgs } from '../../types'
import { removeForSession } from './cache'
import { requireFolder, sessionGroup } from './folderContext'
import { requireOwner } from './memberships'
import { getState, patchState } from './state'

/** Blocks new work transactionally before checking the sidecar's live jobs. */
export async function begin(ctx: MutationCtx, args: FolderTransitionArgs) {
  if (!transitionActive(args.token))
    error('Folder update timed out; try again', 409)

  const user = await findUserBySubject(ctx, args.subject)
  if (!user) error('Unauthorized', 401)
  if (args.sources) requireRole(user.role, 'admin')

  const folder = args.folderId
    ? await requireFolder(ctx, args.folderId, user._id)
    : null

  if (args.sessionId) {
    const { session } = await requireOwner(ctx, args.sessionId, user._id)
    if (session.parent) error('Sub-agent sessions follow their parent', 409)
    if (session.contextLock) error('Session is being moved', 409)
    if (session.folderId) await requireFolder(ctx, session.folderId, user._id)

    const changesWorkspace =
      session.folderId !== args.folderId &&
      Boolean(session.workspace || folder?.sources.length)
    if (changesWorkspace) await assertIdle(ctx, session)

    await ctx.db.patch(session._id, { contextLock: args.token })

    return {
      targetRevision: folder?.revision,
      sessionIds: [session._id],
      needsSidecar: changesWorkspace,
    }
  }

  if (!folder) error('Folder not found', 404)

  const sessions = await ctx.db
    .query('sessions')
    .withIndex('by_folderId', (q) => q.eq('folderId', folder._id))
    .collect()
  for (const session of sessions) await assertIdle(ctx, session)

  await ctx.db.patch(folder._id, { contextLock: args.token })

  return {
    targetRevision: undefined,
    sessionIds: sessions.filter((s) => !s.parent).map((s) => s._id),
    needsSidecar: Boolean(folder.sources.length || args.sources?.length),
  }
}

async function assertIdle(ctx: MutationCtx, session: Doc<'sessions'>) {
  const stream = await ctx.db
    .query('streams')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
    .first()
  const pending = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
    .filter((q) => q.eq(q.field('status'), 'processing'))
    .first()
  if (stream || pending || transitionActive(session.contextLock))
    error(
      'Wait for sessions and their tools to finish before changing sources',
      409,
    )
  const children = await ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) =>
      q.eq('parent.sessionId', session._id),
    )
    .collect()
  for (const child of children) await assertIdle(ctx, child)
}

/** Commits only the operation that owns the transition lock. */
export async function finish(ctx: MutationCtx, args: FolderFinishArgs) {
  if (args.commit && !transitionActive(args.token))
    error('Folder update timed out; try again', 409)
  const user = await findUserBySubject(ctx, args.subject)
  if (!user) error('Unauthorized', 401)
  if (args.sessionId) {
    const session = await ctx.db.get(args.sessionId)
    if (
      !session ||
      session.ownerId !== user._id ||
      session.contextLock !== args.token
    )
      error('Session transition expired', 409)
    if (args.commit) {
      if (args.folderId) {
        const target = await requireFolder(ctx, args.folderId, user._id)
        if (target.revision !== args.targetRevision)
          error('Destination sources changed; try moving again', 409)
      }
      await move(ctx, session, args.folderId, args.unpin)
    }
    await ctx.db.patch(session._id, { contextLock: undefined })
    return
  }
  const folder = args.folderId ? await ctx.db.get(args.folderId) : null
  if (
    !folder ||
    folder.ownerId !== user._id ||
    folder.contextLock !== args.token
  )
    error('Folder transition expired', 409)
  if (args.commit && args.remove) {
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_folderId', (q) => q.eq('folderId', folder._id))
      .collect()
    for (const session of sessions) await move(ctx, session)
    await ctx.db.delete(folder._id)
  } else {
    await ctx.db.patch(folder._id, {
      contextLock: undefined,
      ...(args.commit && args.sources
        ? { sources: args.sources, revision: folder.revision + 1 }
        : {}),
    })
  }
}

async function move(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  folderId?: Id<'sessionFolders'>,
  unpin?: boolean,
) {
  await ctx.db.patch(session._id, { folderId })
  if (session.folderId !== folderId) {
    const state = await getState(ctx, session._id)
    if (state?.toolApprovals?.paths)
      await patchState(ctx, session._id, {
        toolApprovals: { ...state.toolApprovals, paths: undefined },
        pathApprovalRevision: undefined,
      })
    await removeForSession(ctx, session._id)
  }
  const members = await ctx.db
    .query('userSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
    .collect()
  for (const member of members) {
    const pinned = member.role === 'owner' && unpin ? undefined : member.pinned
    await ctx.db.patch(member._id, {
      pinned,
      groupKey: sessionGroup(member.role, folderId, pinned),
    })
  }
}
