import { folderTrail } from '@sb/core/utils/folder-tree'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { FolderView, Session } from '../../types'

export async function ownerFolders(ctx: QueryCtx, ownerId: Id<'users'>) {
  return ctx.db
    .query('sessionFolders')
    .withIndex('by_ownerId_position', (q) => q.eq('ownerId', ownerId))
    .collect()
}

export function folderWorkspace(
  folder: Doc<'sessionFolders'>,
): Session['workspace'] {
  const primary = folder.sources[0]
  return primary
    ? {
        workspaceId: folder._id,
        folderId: folder._id,
        revision: folder.accessRevision ?? folder.revision,
        path: primary.path,
        label: folder.name,
        sources: folder.sources,
      }
    : undefined
}

export function folderView(
  folders: Doc<'sessionFolders'>[],
  id: Id<'sessionFolders'>,
): FolderView {
  const trail = checkedTrail(folders, id)
  return {
    ...trail.at(-1)!,
    workspace: folderWorkspace(trail[0]!),
    ancestorIds: trail.slice(0, -1).map((f) => f._id),
    folderPath: trail.map((f) => f.name).join(' / '),
  }
}

export function checkedTrail(folders: Doc<'sessionFolders'>[], id: string) {
  try {
    return folderTrail(folders, id)
  } catch {
    error('Invalid folder hierarchy', 409)
  }
}

export async function getFolderBranch(
  ctx: QueryCtx,
  folder: Doc<'sessionFolders'>,
) {
  const folders = [folder]
  const seen = new Set([folder._id])
  for (let index = 0; index < folders.length; index++) {
    const children = await folderChildren(
      ctx,
      folder.ownerId,
      folders[index]!._id,
    )
    for (const child of children) {
      if (seen.has(child._id)) error('Invalid folder hierarchy', 409)
      seen.add(child._id)
      folders.push(child)
    }
  }
  return folders
}

/** Reads only the siblings needed by a folder operation. */
export async function folderChildren(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  parentId?: Id<'sessionFolders'>,
) {
  return ctx.db
    .query('sessionFolders')
    .withIndex('by_ownerId_parentId_position', (q) =>
      q.eq('ownerId', ownerId).eq('parentId', parentId),
    )
    .collect()
}

export async function branchSessions(
  ctx: QueryCtx,
  folders: Doc<'sessionFolders'>[],
) {
  const pages = await Promise.all(
    folders.map((folder) =>
      ctx.db
        .query('sessions')
        .withIndex('by_folderId', (q) => q.eq('folderId', folder._id))
        .collect(),
    ),
  )
  return pages.flat().filter((session) => !session.parent)
}

/** Walks only the selected ancestry on hot session reads. */
export async function readFolderTrail(
  ctx: QueryCtx,
  id: Id<'sessionFolders'>,
  ownerId: Id<'users'>,
) {
  const trail: Doc<'sessionFolders'>[] = []
  const seen = new Set<string>()
  let current: Id<'sessionFolders'> | undefined = id

  while (current) {
    if (seen.has(current)) error('Invalid folder hierarchy', 409)
    seen.add(current)
    const folder: Doc<'sessionFolders'> | null = await ctx.db.get(current)
    if (!folder || folder.ownerId !== ownerId) error('Folder not found', 404)
    trail.unshift(folder)
    current = folder.parentId
  }

  return trail
}
