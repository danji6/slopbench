import { projectFolderMove } from '@sb/core/utils/folder-tree'
import { transitionActive } from '@sb/core/workspace/transition'
import { ConvexError } from 'convex/values'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { type AuthQueryCtx, requireRole } from '../../functions'
import type { FolderCommitPlan, FolderMoveArgs } from '../../types'
import { workspaceKey } from './folderContext'
import { assertSessionsUnlocked } from './folderTransitionLocks'
import {
  invalidateWorkspaces,
  sessionFamilies,
} from './folderTransitionSessions'
import {
  branchSessions,
  folderChildren,
  folderWorkspace,
  getFolderBranch,
  readFolderTrail,
} from './folderTree'
import { assertNoSharedSessions } from './personalFolders'

/** Computes the exact workspace and branch shown by the move confirmation. */
export async function describeMove(
  ctx: QueryCtx,
  args: FolderMoveArgs,
  ownerId: Id<'users'>,
  token?: string,
) {
  const trail = await readFolderTrail(ctx, args.folderId, ownerId)
  const folder = trail.at(-1)!
  const targetTrail = args.parentId
    ? await readFolderTrail(ctx, args.parentId, ownerId)
    : []

  assertUnlocked([...trail, ...targetTrail], token)

  const [sourceSiblings, targetSiblings] = await Promise.all([
    folderChildren(ctx, ownerId, folder.parentId),
    folderChildren(ctx, ownerId, args.parentId ?? undefined),
  ])
  const folders = [
    ...new Map(
      [...trail, ...targetTrail, ...sourceSiblings, ...targetSiblings].map(
        (entry) => [entry._id, entry],
      ),
    ).values(),
  ]
  const resolved = relativeMove(args, folder, targetSiblings)
  const projected = projectMove(folders, resolved)
  const authority = moveAuthority(
    folder,
    trail[0]!,
    targetTrail[0],
    args.parentId,
  )

  const branch = await getFolderBranch(ctx, folder)

  assertUnlocked(branch, token)

  const sessions = await branchSessions(ctx, branch)
  const confirmationKey = JSON.stringify([
    workspaceKey(authority.source),
    workspaceKey(authority.target),
    args.parentId,
    branch.map((f) => f._id).sort(),
    sessions.map((s) => s._id).sort(),
  ])

  return { ...authority, folder, branch, sessions, projected, confirmationKey }
}

/** Resolves relative placement against all siblings, including unloaded pages. */
function relativeMove(
  args: FolderMoveArgs,
  folder: Doc<'sessionFolders'>,
  siblings: Doc<'sessionFolders'>[],
): FolderMoveArgs {
  if (args.direction) {
    const index = siblings.findIndex((entry) => entry._id === folder._id)
    const target = index + args.direction
    if (target < 0 || target >= siblings.length)
      return { ...args, beforeFolderId: siblings[index + 1]?._id }
    return {
      ...args,
      beforeFolderId:
        args.direction < 0 ? siblings[target]?._id : siblings[target + 1]?._id,
    }
  }
  if (!args.afterFolderId) return args

  const remaining = siblings.filter((entry) => entry._id !== folder._id)
  const index = remaining.findIndex((entry) => entry._id === args.afterFolderId)
  if (index < 0) error('Folder list changed, try again', 409)

  return { ...args, beforeFolderId: remaining[index + 1]?._id }
}

function assertUnlocked(folders: Doc<'sessionFolders'>[], token?: string) {
  const locked = folders.some(
    (folder) =>
      transitionActive(folder.contextLock) && folder.contextLock !== token,
  )
  if (locked) error('Folder sources are being updated', 409)
}

function projectMove(folders: Doc<'sessionFolders'>[], args: FolderMoveArgs) {
  try {
    return projectFolderMove(folders, args)
  } catch (err) {
    error(err instanceof Error ? err.message : 'Invalid folder move', 409)
  }
}

function moveAuthority(
  folder: Doc<'sessionFolders'>,
  root: Doc<'sessionFolders'>,
  targetRoot: Doc<'sessionFolders'> | undefined,
  parentId: FolderMoveArgs['parentId'],
) {
  const source = folderWorkspace(root)
  const promoting = Boolean(folder.parentId && !parentId)
  const sources = promoting ? (source?.sources ?? []) : folder.sources

  const target = targetRoot
    ? folderWorkspace(targetRoot)
    : folderWorkspace({
        ...folder,
        sources,
        revision: folder.revision + (promoting ? 1 : 0),
      })

  const changesWorkspace = workspaceKey(source) !== workspaceKey(target)

  const replacesSources = Boolean(
    !folder.parentId && parentId && folder.sources.length,
  )

  return {
    source,
    target,
    sources,
    promoting,
    changesWorkspace,
    requiresAdmin: Boolean(replacesSources || (promoting && sources.length)),
    needsConfirmation: changesWorkspace || replacesSources,
  }
}

export async function preview(ctx: AuthQueryCtx, args: FolderMoveArgs) {
  try {
    return await movePreview(ctx, args)
  } catch (err) {
    if (!(err instanceof ConvexError)) throw err
    return { ok: false as const, message: String(err.data.message) }
  }
}

async function movePreview(ctx: AuthQueryCtx, args: FolderMoveArgs) {
  const move = await describeMove(ctx, args, ctx.userId)

  if (move.target) {
    for (const folder of move.branch)
      await assertNoSharedSessions(ctx, folder._id)
  }

  return {
    ok: true as const,
    sources: move.target?.sources ?? [],
    sourceLabel: move.target?.label,
    affectedSessions: move.sessions.length,
    requiresAdmin: move.requiresAdmin,
    needsConfirmation: move.needsConfirmation,
    confirmationKey: move.confirmationKey,
  }
}

export async function validateMove(
  ctx: MutationCtx,
  move: Awaited<ReturnType<typeof describeMove>>,
  role: Parameters<typeof requireRole>[0],
) {
  assertSessionsUnlocked(await sessionFamilies(ctx, move.sessions))
  if (move.requiresAdmin) requireRole(role, 'admin')
  if (move.target)
    for (const folder of move.branch)
      await assertNoSharedSessions(ctx, folder._id)
}

export async function finishMove(
  ctx: MutationCtx,
  args: Extract<FolderCommitPlan, { kind: 'move-folder' }>,
  token: string,
  ownerId: Id<'users'>,
  role: Parameters<typeof requireRole>[0],
) {
  const move = await describeMove(ctx, args, ownerId, token)
  await validateMove(ctx, move, role)

  const workspaceChanged =
    workspaceKey(move.source) !== args.sourceWorkspaceKey ||
    workspaceKey(move.target) !== args.targetWorkspaceKey
  if (workspaceChanged) error('Folder sources changed; try moving again', 409)
  if (move.needsConfirmation && move.confirmationKey !== args.confirmationKey)
    error('Folder contents changed; review the move again', 409)

  return commitMove(ctx, move, args.parentId ?? null)
}

/** Writes a validated tree move and invalidates only changed workspace authority. */
export async function commitMove(
  ctx: MutationCtx,
  move: Awaited<ReturnType<typeof describeMove>>,
  parentId: FolderMoveArgs['parentId'],
) {
  for (const projected of move.projected) {
    if (projected._id === move.folder._id) {
      await ctx.db.patch(projected._id, {
        parentId: projected.parentId,
        position: projected.position,
        organizationRevision: (move.folder.organizationRevision ?? 0) + 1,
        contextLock: undefined,
        sources: parentId ? [] : move.sources,
        revision:
          move.folder.revision +
          (move.promoting || (!move.folder.parentId && !!parentId) ? 1 : 0),
      })
    } else if (
      projected.position !== (await ctx.db.get(projected._id))?.position
    ) {
      await ctx.db.patch(projected._id, { position: projected.position })
    }
  }
  if (move.changesWorkspace)
    await invalidateWorkspaces(ctx, await sessionFamilies(ctx, move.sessions))
  return (move.folder.organizationRevision ?? 0) + 1
}
