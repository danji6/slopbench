import type { FolderMoveArgs, FolderView } from '@sb/convex/types'
import { folderSiblings, projectFolderMove } from '@sb/core/utils/folder-tree'

import type { GroupRow } from './session-groups'

export type FolderDropPlacement = 'before' | 'inside' | 'after'

/** Places insertion cues at branch boundaries and nesting cues across the branch. */
export function folderDropAppearance(
  row: GroupRow,
  target?: { folderId: string; placement: FolderDropPlacement },
) {
  const containsTarget = Boolean(
    target &&
    (target.folderId === row.key || row.ancestorIds?.includes(target.folderId)),
  )
  const highlighted = target?.placement === 'inside' && containsTarget

  return {
    highlighted,
    first: highlighted && row.kind === 'header' && target?.folderId === row.key,
    last:
      highlighted &&
      Boolean(row.endingFolderIds?.includes(target!.folderId) ?? row.last),
    lineBefore:
      target?.placement === 'before' &&
      row.kind === 'header' &&
      target.folderId === row.key,
    lineAfter:
      target?.placement === 'after' &&
      row.endingFolderIds?.includes(target.folderId),
    depth:
      target?.folderId === row.key
        ? (row.depth ?? 0)
        : (row.ancestorIds?.indexOf(target?.folderId ?? '') ?? 0),
  }
}

/** Translates the hovered header zone into a sibling insertion or parent change. */
export function folderDropIntent(
  folders: FolderView[],
  folderId: string,
  targetId: string,
  placement: FolderDropPlacement,
): FolderMoveArgs | null {
  const target = folders.find((folder) => folder._id === targetId)
  const active = folders.find((folder) => folder._id === folderId)
  if (!target || !active || target._id === active._id) return null

  const siblings = folderSiblings(folders, target.parentId)
  const index = siblings.findIndex((folder) => folder._id === targetId)

  const input: FolderMoveArgs = {
    folderId: active._id,
    parentId: placement === 'inside' ? target._id : (target.parentId ?? null),
    beforeFolderId:
      placement === 'before'
        ? target._id
        : placement === 'after'
          ? siblings[index + 1]?._id
          : undefined,
  }
  if (input.beforeFolderId === active._id) return null

  try {
    projectFolderMove(folders, input)
    return input
  } catch {
    return null
  }
}

export function folderMoveNeedsConfirmation(
  folders: FolderView[],
  input: FolderMoveArgs,
) {
  const folder = folders.find((f) => f._id === input.folderId)
  const parent = folders.find((f) => f._id === input.parentId)

  if (!folder) return false
  if (folder.parentId && !input.parentId) return Boolean(folder.workspace)
  return (
    folder.workspace?.workspaceId !==
    (input.parentId
      ? parent?.workspace?.workspaceId
      : folder.workspace?.workspaceId)
  )
}

export function folderMoveConfirmed(
  folders: FolderView[],
  input: FolderMoveArgs,
  revision?: number,
) {
  const folder = folders.find((f) => f._id === input.folderId)

  if (!folder) return true
  if (revision !== undefined) return (folder.organizationRevision ?? 0) >= revision // prettier-ignore
  if (folder.parentId !== (input.parentId ?? undefined)) return false

  const siblings = folderSiblings(folders, folder.parentId)
  return (
    siblings[siblings.findIndex((f) => f._id === folder._id) + 1]?._id ===
    input.beforeFolderId
  )
}
