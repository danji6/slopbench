import { stream } from 'convex-helpers/server/stream'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthQueryCtx } from '../../functions'
import schema from '../../schema'
import type { FolderPageArgs, FolderPickerArgs, FolderView } from '../../types'
import { folderWorkspace, readFolderTrail } from './folderTree'

/** Resolves one folder without loading unrelated branches. */
export async function view(
  ctx: QueryCtx,
  folder: Doc<'sessionFolders'>,
): Promise<FolderView> {
  const trail = await readFolderTrail(ctx, folder._id, folder.ownerId)
  return {
    ...folder,
    workspace: folderWorkspace(trail[0]!),
    ancestorIds: trail.slice(0, -1).map((entry) => entry._id),
    folderPath: trail.map((entry) => entry.name).join(' / '),
  }
}

export async function get(
  ctx: AuthQueryCtx,
  { folderId }: { folderId: Id<'sessionFolders'> },
) {
  const folder = await ctx.db.get(folderId)
  return folder?.ownerId === ctx.userId ? view(ctx, folder) : null
}

/** Paginates direct display children, keeping pinned folders in their own section. */
export async function page(ctx: AuthQueryCtx, args: FolderPageArgs) {
  const pinned = args.groupKey === 'pinned'
  const parentId =
    args.groupKey === 'ungrouped' || pinned
      ? undefined
      : ctx.db.normalizeId('sessionFolders', args.groupKey)
  if (parentId === null) error('Folder not found', 404)

  if (parentId && !(await get(ctx, { folderId: parentId })))
    error('Folder not found', 404)

  const folders = ctx.db.query('sessionFolders')
  const query = pinned
    ? folders.withIndex('by_owner_pinned_order', (q) =>
        q.eq('ownerId', ctx.userId).eq('pinned', true),
      )
    : folders.withIndex('by_owner_parent_pinned_position', (q) =>
        q
          .eq('ownerId', ctx.userId)
          .eq('parentId', parentId)
          .eq('pinned', undefined),
      )

  const result = await query.paginate(args.paginationOpts)

  return {
    ...result,
    page: await Promise.all(result.page.map((folder) => view(ctx, folder))),
  }
}

/** Searches path labels in bounded candidate pages, independently of sidebar pages. */
export async function picker(ctx: AuthQueryCtx, args: FolderPickerArgs) {
  const search = args.search?.trim().toLocaleLowerCase() ?? ''
  return stream(ctx.db, schema)
    .query('sessionFolders')
    .withIndex('by_ownerId_position', (q) => q.eq('ownerId', ctx.userId))
    .map((folder) => view(ctx, folder))
    .filterWith(async (folder) => {
      if (args.organizationOnly && folder.workspace) return false
      if (folder._id === args.excludeBranchId) return false
      if (
        args.excludeBranchId &&
        folder.ancestorIds.includes(args.excludeBranchId)
      )
        return false
      return folder.folderPath.toLocaleLowerCase().includes(search)
    })
    .paginate({ ...args.paginationOpts, maximumRowsRead: 100 })
}
