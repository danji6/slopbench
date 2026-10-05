import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import { sessionGroup } from './folderContext'

/** Moves only the caller's membership, preserving the owner's workspace. */
export async function moveSharedSession(
  ctx: MutationCtx,
  membership: Doc<'userSessions'>,
  folder: Doc<'sessionFolders'> | null,
  unpin?: boolean,
) {
  if (folder?.sources.length)
    error('Shared sessions can only be placed in folders without sources', 409)
  const pinned = unpin ? undefined : membership.pinned
  await ctx.db.patch(membership._id, {
    folderId: folder?._id,
    pinned,
    groupKey: sessionGroup(folder?._id, pinned),
  })
}

/** Prevents an organizational folder from gaining sources while it has joined chats. */
export async function assertNoSharedSessions(
  ctx: MutationCtx,
  folderId: Id<'sessionFolders'>,
) {
  const member = await ctx.db
    .query('userSessions')
    .withIndex('by_folderId', (q) => q.eq('folderId', folderId))
    .first()
  if (member)
    error('Move shared sessions out of this folder before adding sources', 409)
}

/** Returns joined chats to Ungrouped when their personal folder is deleted. */
export async function clearSharedFolder(
  ctx: MutationCtx,
  folderId: Id<'sessionFolders'>,
) {
  const members = await ctx.db
    .query('userSessions')
    .withIndex('by_folderId', (q) => q.eq('folderId', folderId))
    .collect()
  for (const member of members) {
    await ctx.db.patch(member._id, {
      folderId: undefined,
      groupKey: sessionGroup(undefined, member.pinned),
    })
  }
}
