import { transitionActive } from '@sb/core/workspace/transition'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import { requireRole } from '../../functions'
import type {
  FolderCommand,
  FolderCommitArgs,
  FolderCommitPlan,
  FolderLockTarget,
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
  assertSessionsUnlocked,
  assertTransitionActive,
  ownsTransition,
  transitionUser,
} from './folderTransitionLocks'
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

type Command<K extends FolderCommand['kind']> = Extract<
  FolderCommand,
  { kind: K }
>

type Plan<K extends FolderCommitPlan['kind']> = Extract<
  FolderCommitPlan,
  { kind: K }
>

type Preparation =
  | { kind: 'completed'; organizationRevision?: number }
  | {
      kind: 'prepared'
      plan: FolderCommitPlan
      target: FolderLockTarget
      sessionIds: Id<'sessions'>[]
      needsSidecar: boolean
    }

type FolderUpdate = Command<'update-sources' | 'delete-folder'>

function completed(organizationRevision?: number): Preparation {
  return { kind: 'completed', organizationRevision }
}

/** Locks affected sessions or folders before the sidecar checks live jobs. */
export async function begin(
  ctx: MutationCtx,
  args: FolderTransitionArgs,
): Promise<Preparation> {
  assertTransitionActive(args.token)
  const user = await transitionUser(ctx, args.subject)
  const command = args.command
  switch (command.kind) {
    case 'move-session':
      return beginSessionMove(ctx, command, user._id, args.token)
    case 'move-folder':
      return beginBranchMove(ctx, command, user, args.token)
    case 'update-sources':
      requireRole(user.role, 'admin')
      return beginFolderUpdate(ctx, command, user._id, args.token)
    case 'delete-folder':
      return beginFolderUpdate(ctx, command, user._id, args.token)
  }
}

async function beginBranchMove(
  ctx: MutationCtx,
  command: Command<'move-folder'>,
  user: Doc<'users'>,
  token: string,
) {
  const move = await describeMove(ctx, command, user._id)
  await validateMove(ctx, move, user.role)
  const needsReview =
    move.needsConfirmation && command.confirmationKey !== move.confirmationKey
  if (needsReview)
    error('Review the workspace access change before moving this folder', 409)
  if (!move.changesWorkspace)
    return completed(await commitMove(ctx, move, command.parentId))
  return lockFolder(
    ctx,
    command,
    token,
    move.folder,
    move.sessions,
    move.source,
    move.target,
  )
}

async function beginSessionMove(
  ctx: MutationCtx,
  command: Command<'move-session'>,
  userId: Id<'users'>,
  token: string,
): Promise<Preparation> {
  const folder = command.folderId
    ? await requireFolder(ctx, command.folderId, userId)
    : null
  const { session, membership } = await requireMember(
    ctx,
    command.sessionId,
    userId,
  )
  if (session.parent) error('Sub-agent sessions follow their parent', 409)
  if (membership.role !== 'owner') {
    await moveSharedSession(ctx, membership, folder, command.unpin)
    return completed()
  }
  if (session.contextLock) error('Session is being moved', 409)
  const sourceWorkspaceKey = workspaceKey(session.workspace)
  const targetWorkspaceKey = workspaceKey(folder?.workspace)
  if (sourceWorkspaceKey === targetWorkspaceKey) {
    await placeSession(ctx, session, command.folderId, command.unpin)
    return completed()
  }
  const sessions = await sessionFamilies(ctx, [session])
  await assertSessionsIdle(ctx, sessions)
  await ctx.db.patch(session._id, { contextLock: token })
  return {
    kind: 'prepared',
    target: { kind: 'session', id: session._id },
    plan: {
      ...command,
      sourceWorkspaceKey,
      targetWorkspaceKey,
      targetRevision: folder?.revision ?? null,
    },
    sessionIds: sessions.map((s) => s._id),
    needsSidecar: true,
  }
}

async function updateTarget(
  ctx: MutationCtx,
  command: FolderUpdate,
  folder: Awaited<ReturnType<typeof requireFolder>>,
) {
  if (command.kind === 'update-sources') {
    if (folder.parentId)
      error('Subfolders inherit sources from their root folder', 400)
    return folderWorkspace({
      ...folder,
      sources: command.sources,
      accessRevision: sourceAccessRevision(folder, command.sources),
    })
  }
  const parent = folder.parentId
    ? await requireFolder(ctx, folder.parentId, folder.ownerId)
    : null
  return parent?.workspace
}

async function validateBranch(
  ctx: MutationCtx,
  command: FolderUpdate,
  branch: Doc<'sessionFolders'>[],
  token?: string,
) {
  for (const entry of branch) {
    const locked =
      transitionActive(entry.contextLock) && entry.contextLock !== token
    if (locked) error('Folder sources are being updated', 409)
    if (command.kind === 'update-sources' && command.sources.length) {
      await assertNoSharedSessions(ctx, entry._id)
    }
  }
}

async function beginFolderUpdate(
  ctx: MutationCtx,
  command: FolderUpdate,
  ownerId: Id<'users'>,
  token: string,
) {
  const folder = await requireFolder(ctx, command.folderId, ownerId)
  const target = await updateTarget(ctx, command, folder)
  const branch = await getFolderBranch(ctx, folder)
  await validateBranch(ctx, command, branch)
  const sessions = await branchSessions(ctx, branch)

  if (workspaceKey(folder.workspace) === workspaceKey(target)) {
    const family = await sessionFamilies(ctx, sessions)
    assertSessionsUnlocked(family)
    if (command.kind === 'update-sources') await assertSessionsIdle(ctx, family)
    await applyFolderUpdate(ctx, command, folder, branch, false)
    return completed()
  }

  return lockFolder(
    ctx,
    command,
    token,
    folder,
    sessions,
    folder.workspace,
    target,
  )
}

type LockFolderCommand = Exclude<FolderCommand, { kind: 'move-session' }>
async function lockFolder(
  ctx: MutationCtx,
  command: LockFolderCommand,
  token: string,
  folder: Doc<'sessionFolders'>,
  roots: Doc<'sessions'>[],
  source: Session['workspace'],
  target: Session['workspace'],
): Promise<Preparation> {
  const sessions = await sessionFamilies(ctx, roots)
  const sourceWorkspaceKey = workspaceKey(source)
  const targetWorkspaceKey = workspaceKey(target)
  const changesWorkspace = sourceWorkspaceKey !== targetWorkspaceKey

  if (changesWorkspace) await assertSessionsIdle(ctx, sessions)
  assertSessionsUnlocked(sessions)

  await ctx.db.patch(folder._id, { contextLock: token })

  return {
    kind: 'prepared',
    target: { kind: 'folder', id: folder._id },
    plan: {
      ...command,
      sourceWorkspaceKey,
      targetWorkspaceKey,
      sourceRevision: folder.revision,
    },
    sessionIds: sessions.map((s) => s._id),
    needsSidecar: changesWorkspace,
  }
}

/** Revalidates snapshots and commits only the transition owning the lock. */
export async function commit(ctx: MutationCtx, args: FolderCommitArgs) {
  assertTransitionActive(args.token)
  const user = await transitionUser(ctx, args.subject)
  const plan = args.plan
  if (plan.kind === 'move-session')
    return commitSessionMove(ctx, plan, user._id, args.token)

  const folder = await ctx.db.get(plan.folderId)
  if (!ownsTransition(folder, user._id, args.token))
    error('Folder transition expired', 409)

  if (folder.revision !== plan.sourceRevision)
    error('Folder sources changed; try moving again', 409)

  if (plan.kind === 'move-folder')
    return finishMove(ctx, plan, args.token, user._id, user.role)
  if (plan.kind === 'update-sources') requireRole(user.role, 'admin')

  const current = await requireFolder(ctx, folder._id, user._id, args.token)
  const target = await updateTarget(ctx, plan, current)
  const changed =
    workspaceKey(current.workspace) !== plan.sourceWorkspaceKey ||
    workspaceKey(target) !== plan.targetWorkspaceKey
  if (changed) error('Folder sources changed; try moving again', 409)

  const branch = await getFolderBranch(ctx, folder)
  await validateBranch(ctx, plan, branch, args.token)

  return applyFolderUpdate(ctx, plan, folder, branch, true)
}

async function commitSessionMove(
  ctx: MutationCtx,
  plan: Plan<'move-session'>,
  ownerId: Id<'users'>,
  token: string,
) {
  const session = await ctx.db.get(plan.sessionId)
  if (!ownsTransition(session, ownerId, token))
    error('Session transition expired', 409)

  const target = plan.folderId
    ? await requireFolder(ctx, plan.folderId, ownerId)
    : null

  const destinationChanged =
    (target?.revision ?? null) !== plan.targetRevision ||
    workspaceKey(target?.workspace) !== plan.targetWorkspaceKey
  if (destinationChanged)
    error('Destination sources changed, try moving again', 409)

  const source = await getSessionWithWorkspace(ctx, session._id)
  if (workspaceKey(source?.workspace) !== plan.sourceWorkspaceKey)
    error('Folder sources changed, try moving again', 409)

  await placeSession(ctx, session, plan.folderId, plan.unpin)
  const changesWorkspace = plan.sourceWorkspaceKey !== plan.targetWorkspaceKey
  if (changesWorkspace)
    await invalidateWorkspaces(ctx, await sessionFamilies(ctx, [session]))
  await ctx.db.patch(session._id, { contextLock: undefined })
}

async function applyFolderUpdate(
  ctx: MutationCtx,
  command: FolderUpdate,
  folder: Doc<'sessionFolders'>,
  branch: Doc<'sessionFolders'>[],
  changesWorkspace: boolean,
) {
  if (command.kind === 'delete-folder') return deleteBranch(ctx, folder, branch)
  await ctx.db.patch(folder._id, {
    contextLock: undefined,
    sources: command.sources,
    accessRevision: sourceAccessRevision(folder, command.sources),
    revision: folder.revision + 1,
  })
  if (changesWorkspace) {
    await invalidateWorkspaces(
      ctx,
      await sessionFamilies(ctx, await branchSessions(ctx, branch)),
    )
  }
}

async function deleteBranch(
  ctx: MutationCtx,
  folder: Doc<'sessionFolders'>,
  branch: Doc<'sessionFolders'>[],
) {
  const targetTrail = folder.parentId
    ? await readFolderTrail(ctx, folder.parentId, folder.ownerId)
    : []
  const targetLocked = targetTrail.some((entry) =>
    transitionActive(entry.contextLock),
  )
  if (targetLocked) error('Folder sources are being updated', 409)

  const sourceTrail = await readFolderTrail(ctx, folder._id, folder.ownerId)

  const changesWorkspace =
    workspaceKey(folderWorkspace(sourceTrail[0]!)) !==
    workspaceKey(targetTrail[0] ? folderWorkspace(targetTrail[0]) : undefined)

  const roots = await branchSessions(ctx, branch)
  for (const session of roots) await placeSession(ctx, session, folder.parentId)

  if (changesWorkspace)
    await invalidateWorkspaces(ctx, await sessionFamilies(ctx, roots))

  for (const entry of [...branch].reverse()) {
    await clearSharedFolder(ctx, entry._id, folder.parentId)
    await ctx.db.delete(entry._id)
  }
}

/** Keeps discovery settings separate from filesystem authority. */
function sourceAccessRevision(
  folder: Doc<'sessionFolders'>,
  sources: Doc<'sessionFolders'>['sources'],
) {
  const accessConfiguration = (items: typeof sources) =>
    items.map(({ id, path, label }) => ({ id, path, label }))
  const changed =
    JSON.stringify(accessConfiguration(folder.sources)) !==
    JSON.stringify(accessConfiguration(sources))
  return (folder.accessRevision ?? folder.revision) + Number(changed)
}
