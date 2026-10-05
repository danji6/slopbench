import { transitionActive } from '@sb/core/workspace/transition'

import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { Session } from '../../types'

/** Resolves workspace authority exclusively from the root session's folder. */
export async function withFolderWorkspace(ctx: QueryCtx, session: Session) {
  const root = session.parent
    ? await ctx.db.get(session.parent.sessionId)
    : session
  const folder = root?.folderId ? await ctx.db.get(root.folderId) : null
  const primary = folder?.sources[0]
  const lock = [
    session.contextLock,
    root?.contextLock,
    folder?.contextLock,
  ].find((token) => transitionActive(token))

  return {
    ...session,
    folderId: root?.folderId,
    contextLock: lock,
    workspace:
      primary && folder
        ? {
            workspaceId: folder._id,
            folderId: folder._id,
            revision: folder.revision,
            path: primary.path,
            label: folder.name,
            sources: folder.sources,
          }
        : undefined,
  }
}

export async function getSessionWithWorkspace(
  ctx: QueryCtx,
  id: Id<'sessions'>,
) {
  const session = await ctx.db.get(id)
  return session ? withFolderWorkspace(ctx, session) : null
}

export async function requireFolder(
  ctx: QueryCtx,
  id: Id<'sessionFolders'>,
  ownerId: Id<'users'>,
) {
  const folder = await ctx.db.get(id)
  if (!folder || folder.ownerId !== ownerId) error('Folder not found', 404)
  if (transitionActive(folder.contextLock))
    error('Folder sources are being updated', 409)
  return folder
}

export function sessionGroup(
  folderId?: Id<'sessionFolders'>,
  pinned?: boolean,
) {
  return pinned ? 'pinned' : (folderId ?? 'ungrouped')
}

export function workspaceKey(workspace: Session['workspace']) {
  return workspace
    ? JSON.stringify([
        workspace.workspaceId,
        workspace.revision ?? 0,
        workspace.sources?.map((source) => source.path) ?? [workspace.path],
      ])
    : '[]'
}
