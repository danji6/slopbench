import { transitionActive } from '@sb/core/workspace/transition'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject, requireRole } from '../../functions'
import type {
  FolderFinishArgs,
  FolderTransitionArgs,
  Session,
} from '../../types'
import {
  getSessionWithWorkspace,
  requireFolder,
  workspaceKey,
} from './folderContext'
import {
  commitMove,
  describeMove,
  finishMove,
  validateMove,
} from './folderMoves'
import {
  assertSessionsIdle,
  invalidateWorkspaces,
  placeSession,
  sessionFamilies,
} from './folderTransitionSessions'
import {
  branchSessions,
  folderWorkspace,
  getFolderBranch,
  readFolderTrail,
} from './folderTree'
import { requireMember } from './memberships'
import {
  assertNoSharedSessions,
  clearSharedFolder,
  moveSharedSession,
} from './personalFolders'

function completed(organizationRevision?: number) {
  return {
    personalMoved: true,
    targetRevision: undefined,
    targetWorkspaceKey: undefined,
    sourceWorkspaceKey: undefined,
    sessionIds: [],
    needsSidecar: false,
    organizationRevision,
  }
}

/** Locks the affected ancestry before checking the sidecar's live jobs. */
export async function begin(ctx: MutationCtx, args: FolderTransitionArgs) {
  if (!transitionActive(args.token))
    error('Folder update timed out, try again', 409)

  const user = await findUserBySubject(ctx, args.subject)
  if (!user) error('Unauthorized', 401)
  if (args.sources) requireRole(user.role, 'admin')

  const ops = [
    Boolean(args.sessionId),
    args.parentId !== undefined,
    args.sources !== undefined,
    Boolean(args.remove),
  ]
  if (ops.filter(Boolean).length !== 1)
    error('Choose one folder operation', 400)

  const folder = args.folderId
    ? await requireFolder(ctx, args.folderId, user._id)
    : null

  if (args.parentId !== undefined) return beginBranchMove(ctx, args, user)
  return args.sessionId
    ? beginSessionMove(ctx, args, user._id, folder)
    : beginFolderUpdate(ctx, args, folder)
}

async function beginBranchMove(
  ctx: MutationCtx,
  args: FolderTransitionArgs,
  user: Doc<'users'>,
) {
  const folder = args.folderId
    ? await requireFolder(ctx, args.folderId, user._id)
    : null
  if (!folder) error('Folder not found', 404)

  const move = await describeMove(
    ctx,
    { ...args, folderId: folder._id, parentId: args.parentId ?? null },
    user._id,
  )
  await validateMove(ctx, move, user.role)

  if (move.needsConfirmation && args.confirmationKey !== move.confirmationKey)
    error('Review the workspace access change before moving this folder', 409)
  if (!move.changesWorkspace) {
    const revision = await commitMove(ctx, move, args.parentId ?? null)
    return completed(revision)
  }
  return lockFolder(ctx, args, folder, move.sessions, move.source, move.target)
}

async function beginSessionMove(
  ctx: MutationCtx,
  args: FolderTransitionArgs,
  userId: Id<'users'>,
  folder: Awaited<ReturnType<typeof requireFolder>> | null,
) {
  const { session, membership } = await requireMember(
    ctx,
    args.sessionId!,
    userId,
  )
  if (session.parent) error('Sub-agent sessions follow their parent', 409)
  if (membership.role !== 'owner') {
    await moveSharedSession(ctx, membership, folder, args.unpin)
    return completed()
  }
  if (session.contextLock) error('Session is being moved', 409)

  const changesWorkspace =
    workspaceKey(session.workspace) !== workspaceKey(folder?.workspace)
  if (!changesWorkspace) {
    await placeSession(ctx, session, args.folderId, args.unpin)
    return completed()
  }

  const sessions = await sessionFamilies(ctx, [session])
  await assertSessionsIdle(ctx, sessions)
  await ctx.db.patch(session._id, { contextLock: args.token })

  return {
    personalMoved: false,
    targetRevision: folder?.revision,
    targetWorkspaceKey: workspaceKey(folder?.workspace),
    sourceWorkspaceKey: workspaceKey(session.workspace),
    sessionIds: sessions.map((s) => s._id),
    needsSidecar: changesWorkspace,
  }
}

async function beginFolderUpdate(
  ctx: MutationCtx,
  args: FolderTransitionArgs,
  folder: Awaited<ReturnType<typeof requireFolder>> | null,
) {
  if (!folder) error('Folder not found', 404)
  if (args.sources && folder.parentId)
    error('Subfolders inherit sources from their root folder', 400)

  const branch = await getFolderBranch(ctx, folder)
  for (const entry of branch) {
    if (transitionActive(entry.contextLock))
      error('Folder sources are being updated', 409)
    if (args.sources?.length) await assertNoSharedSessions(ctx, entry._id)
  }

  const targetFolder = folder.parentId
    ? await requireFolder(ctx, folder.parentId, folder.ownerId)
    : null

  const target = args.remove
    ? targetFolder?.workspace
    : folderWorkspace({
        ...folder,
        sources: args.sources!,
        revision: folder.revision + 1,
      })

  const sessions = await branchSessions(ctx, branch)

  if (workspaceKey(folder.workspace) === workspaceKey(target)) {
    const isMoving = (await sessionFamilies(ctx, sessions)).some((session) =>
      transitionActive(session.contextLock),
    )
    if (isMoving) {
      error('Session is being moved', 409)
    }
    if (args.remove) {
      await deleteBranch(ctx, folder, branch)
    } else {
      await ctx.db.patch(folder._id, {
        sources: args.sources!,
        revision: folder.revision + 1,
      })
    }
    return completed()
  }
  return lockFolder(ctx, args, folder, sessions, folder.workspace, target)
}

async function lockFolder(
  ctx: MutationCtx,
  args: FolderTransitionArgs,
  folder: Doc<'sessionFolders'>,
  roots: Doc<'sessions'>[],
  source: Session['workspace'],
  target: Session['workspace'],
) {
  const sessions = await sessionFamilies(ctx, roots)
  const changesWorkspace = workspaceKey(source) !== workspaceKey(target)

  if (changesWorkspace) await assertSessionsIdle(ctx, sessions)
  // Also reject a concurrent session move when the workspace itself is unchanged
  if (sessions.some((session) => transitionActive(session.contextLock)))
    error('Session is being moved', 409)

  await ctx.db.patch(folder._id, { contextLock: args.token })
  return {
    personalMoved: false,
    targetRevision: undefined,
    sourceWorkspaceKey: workspaceKey(source),
    targetWorkspaceKey: workspaceKey(target),
    sessionIds: sessions.map((s) => s._id),
    needsSidecar: changesWorkspace,
  }
}

/** Commits only the operation that owns the transition lock. */
export async function finish(ctx: MutationCtx, args: FolderFinishArgs) {
  if (args.commit && !transitionActive(args.token))
    error('Folder update timed out, try again', 409)

  const user = await findUserBySubject(ctx, args.subject)
  if (!user) error('Unauthorized', 401)

  if (args.sessionId) return finishSessionMove(ctx, args, user._id)
  const folder = args.folderId ? await ctx.db.get(args.folderId) : null

  const expired =
    !folder || folder.ownerId !== user._id || folder.contextLock !== args.token
  if (expired) {
    error('Folder transition expired', 409)
  }

  if (!args.commit) {
    await ctx.db.patch(folder._id, { contextLock: undefined })
    return
  }
  if (args.parentId !== undefined)
    return finishMove(ctx, args, user._id, user.role)

  const branch = await getFolderBranch(ctx, folder)
  if (args.remove) return deleteBranch(ctx, folder, branch)

  if (args.sources) {
    requireRole(user.role, 'admin')
    if (folder.parentId)
      error('Subfolders inherit sources from their root folder', 400)

    for (const entry of branch)
      if (args.sources.length) await assertNoSharedSessions(ctx, entry._id)
    await ctx.db.patch(folder._id, {
      contextLock: undefined,
      sources: args.sources,
      revision: folder.revision + 1,
    })
    await invalidateWorkspaces(
      ctx,
      await sessionFamilies(ctx, await branchSessions(ctx, branch)),
    )
  }
}

async function finishSessionMove(
  ctx: MutationCtx,
  args: FolderFinishArgs,
  ownerId: Id<'users'>,
) {
  const session = await ctx.db.get(args.sessionId!)

  const expired =
    !session ||
    session.ownerId !== ownerId ||
    session.contextLock !== args.token
  if (expired) error('Session transition expired', 409)

  if (args.commit) {
    const target = args.folderId
      ? await requireFolder(ctx, args.folderId, ownerId)
      : null

    const dstChanged =
      target &&
      (target.revision !== args.targetRevision ||
        (args.targetWorkspaceKey !== undefined &&
          workspaceKey(target.workspace) !== args.targetWorkspaceKey))
    if (dstChanged) error('Destination sources changed, try moving again', 409)

    const source = await getSessionWithWorkspace(ctx, session._id)
    const srcChanged =
      args.sourceWorkspaceKey !== undefined &&
      workspaceKey(source?.workspace) !== args.sourceWorkspaceKey
    if (srcChanged) error('Folder sources changed, try moving again', 409)

    const changesWorkspace =
      workspaceKey(source?.workspace) !== workspaceKey(target?.workspace)
    await placeSession(ctx, session, args.folderId, args.unpin)
    if (changesWorkspace)
      await invalidateWorkspaces(ctx, await sessionFamilies(ctx, [session]))
  }
  await ctx.db.patch(session._id, { contextLock: undefined })
}

async function deleteBranch(
  ctx: MutationCtx,
  folder: Doc<'sessionFolders'>,
  branch: Doc<'sessionFolders'>[],
) {
  const targetTrail = folder.parentId
    ? await readFolderTrail(ctx, folder.parentId, folder.ownerId)
    : []
  if (targetTrail.some((entry) => transitionActive(entry.contextLock)))
    error('Folder sources are being updated', 409)
  const sourceTrail = await readFolderTrail(ctx, folder._id, folder.ownerId)
  const changesWorkspace =
    workspaceKey(folderWorkspace(sourceTrail[0]!)) !==
    workspaceKey(targetTrail[0] ? folderWorkspace(targetTrail[0]) : undefined)
  const roots = await branchSessions(ctx, branch)
  for (const session of roots) await placeSession(ctx, session, folder.parentId)
  if (changesWorkspace)
    await invalidateWorkspaces(ctx, await sessionFamilies(ctx, roots))
  for (const entry of branch.reverse()) {
    await clearSharedFolder(ctx, entry._id, folder.parentId)
    await ctx.db.delete(entry._id)
  }
}
