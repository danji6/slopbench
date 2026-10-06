import { transitionActive } from '@sb/core/workspace/transition'

import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import {
  type AuthMutationCtx,
  type AuthQueryCtx,
  findUserBySubject,
  requireRole,
} from '../../functions'
import type { FolderCreateArgs, FolderCreateBasicArgs } from '../../types'
import { requireFolder, sessionGroup } from './folderContext'
import { folderView, ownerFolders } from './folderTree'
import { requireMember } from './memberships'

export async function list(ctx: AuthQueryCtx) {
  const folders = await ownerFolders(ctx, ctx.userId)
  return folders.map((folder) => folderView(folders, folder._id))
}

export function folderName(name: string) {
  const value = name.trim()
  if (!value || value.length > 80)
    error('Use a folder name between 1 and 80 characters', 400)
  return value
}

export async function create(
  ctx: AuthMutationCtx,
  args: FolderCreateBasicArgs,
) {
  validateIcon(args.icon)
  const folders = await list(ctx)

  if (folders.length >= 100) error('Folder limit reached (100)', 409)
  if (args.parentId) await requireFolder(ctx, args.parentId, ctx.userId)

  return ctx.db.insert('sessionFolders', {
    ownerId: ctx.userId,
    name: folderName(args.name),
    icon: args.icon,
    parentId: args.parentId,
    position:
      Math.max(
        -1,
        ...folders
          .filter((f) => f.parentId === args.parentId)
          .map((f) => f.position),
      ) + 1,
    sources: [],
    revision: 0,
  })
}

export async function rename(
  ctx: AuthMutationCtx,
  args: { folderId: Id<'sessionFolders'>; name: string; icon?: string },
) {
  validateIcon(args.icon)
  await requireFolder(ctx, args.folderId, ctx.userId)
  await ctx.db.patch(args.folderId, {
    name: folderName(args.name),
    icon: args.icon,
  })
}

export async function reorder(
  ctx: AuthMutationCtx,
  args: { folderIds: Id<'sessionFolders'>[]; parentId?: Id<'sessionFolders'> },
) {
  const all = await list(ctx)
  const folders = all.filter((folder) => folder.parentId === args.parentId)

  const changed =
    args.folderIds.length !== folders.length ||
    new Set(args.folderIds).size !== folders.length ||
    args.folderIds.some((id) => !folders.some((f) => f._id === id))
  if (changed) error('Folder list changed, try again', 409)

  for (const id of args.folderIds) await requireFolder(ctx, id, ctx.userId)

  const updating = all.some(
    (folder) =>
      transitionActive(folder.contextLock) &&
      folders.some(
        (sibling) =>
          sibling._id === folder._id ||
          folder.ancestorIds.includes(sibling._id),
      ),
  )
  if (updating) error('Folder sources are being updated', 409)

  for (const [position, id] of args.folderIds.entries())
    await ctx.db.patch(id, {
      position,
      organizationRevision:
        (folders.find((folder) => folder._id === id)?.organizationRevision ??
          0) + 1,
    })
}

export async function pin(
  ctx: AuthMutationCtx,
  args: { sessionId: Id<'sessions'>; pinned: boolean },
) {
  const { session, membership } = await requireMember(
    ctx,
    args.sessionId,
    ctx.userId,
  )
  if (session.parent) error('Sub-agent sessions cannot be pinned', 409)
  await ctx.db.patch(membership._id, {
    pinned: args.pinned || undefined,
    groupKey: sessionGroup(
      membership.role === 'owner' ? session.folderId : membership.folderId,
      args.pinned,
    ),
  })
}

export async function createWithSources(
  ctx: MutationCtx,
  args: FolderCreateArgs & { subject: string },
) {
  const user = await findUserBySubject(ctx, args.subject)
  if (!user) error('Profile not initialized', 409)

  if (args.parentId && args.sources.length)
    error('Subfolders inherit sources from their root folder', 400)
  if (args.sources.length) requireRole(user.role, 'admin')

  const auth = {
    ...ctx,
    userId: user._id,
    role: user.role,
    subject: args.subject,
  }

  const id = await create(auth, args)
  await ctx.db.patch(id, {
    sources: args.sources,
    revision: args.sources.length ? 1 : 0,
  })

  return id
}

function validateIcon(icon?: string) {
  if (icon && !/^[a-z0-9-]{1,64}$/.test(icon)) error('Invalid folder icon', 400)
}
