import type { FolderMoveArgs, FolderView } from '@cv/convex/types'
import { folderSiblings } from '@cv/core/utils/folder-tree'

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
    first:
      highlighted &&
      (row.kind === 'header' || row.kind === 'separator') &&
      target?.folderId === row.key,
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

  const input: FolderMoveArgs = {
    folderId: active._id,
    parentId: placement === 'inside' ? target._id : (target.parentId ?? null),
    beforeFolderId: placement === 'before' ? target._id : undefined,
    afterFolderId: placement === 'after' ? target._id : undefined,
  }
  if (input.beforeFolderId === active._id) return null

  const destinationAncestry =
    placement === 'inside'
      ? [...target.ancestorIds, target._id]
      : target.ancestorIds
  if (destinationAncestry.includes(active._id)) return null
  return input
}

/** Projects loaded rows without assuming unloaded ancestors or siblings are present. */
export function projectLoadedFolderMove(
  folders: FolderView[],
  input: FolderMoveArgs,
) {
  const moving = folders.find((folder) => folder._id === input.folderId)
  if (!moving) return folders

  const parent = folders.find((folder) => folder._id === input.parentId)
  const siblings = folderSiblings(folders, input.parentId ?? undefined).filter(
    (folder) => folder._id !== moving._id,
  )

  let index = siblings.length

  if (input.beforeFolderId) {
    index = siblings.findIndex((folder) => folder._id === input.beforeFolderId)
  }
  if (input.afterFolderId) {
    index =
      siblings.findIndex((folder) => folder._id === input.afterFolderId) + 1
  }
  if (input.direction) {
    const original = folderSiblings(folders, moving.parentId).findIndex(
      (folder) => folder._id === moving._id,
    )
    index = Math.max(0, Math.min(siblings.length, original + input.direction))
  }

  siblings.splice(Math.max(0, index), 0, moving)

  const positions = new Map(siblings.map((folder, position) => [folder._id, position])) // prettier-ignore
  const ancestorIds = parent ? [...parent.ancestorIds, parent._id] : []
  const folderPath = parent
    ? `${parent.folderPath} / ${moving.name}`
    : moving.name

  return folders.map((folder) => {
    const position = positions.get(folder._id) ?? folder.position
    if (folder._id === moving._id)
      return {
        ...folder,
        parentId: input.parentId ?? undefined,
        position,
        ancestorIds,
        folderPath,
      }
    const offset = folder.ancestorIds.indexOf(moving._id)
    if (offset < 0) return { ...folder, position }
    return {
      ...folder,
      position,
      ancestorIds: [...ancestorIds, ...folder.ancestorIds.slice(offset)],
      folderPath: folder.folderPath.replace(
        `${moving.folderPath} /`,
        `${folderPath} /`,
      ),
    }
  })
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

  if (!folder) return false
  if (revision !== undefined) return (folder.organizationRevision ?? 0) >= revision // prettier-ignore
  if (folder.parentId !== (input.parentId ?? undefined)) return false

  const siblings = folderSiblings(folders, folder.parentId)
  return (
    siblings[siblings.findIndex((f) => f._id === folder._id) + 1]?._id ===
    input.beforeFolderId
  )
}
