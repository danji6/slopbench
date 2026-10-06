import { transitionActive } from '@sb/core/workspace/transition'

import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { Session } from '../../types'
import { folderWorkspace, readFolderTrail } from './folderTree'

/** Resolves workspace authority exclusively from the root session's folder. */
export async function withFolderWorkspace(ctx: QueryCtx, session: Session) {
  const sessions = await readSessionTrail(ctx, session)
  const root = sessions.at(-1)!
  const trail = root?.folderId
    ? await readFolderTrail(ctx, root.folderId, root.ownerId)
    : []
  const lock = [
    ...sessions.map((entry) => entry.contextLock),
    ...trail.map((folder) => folder.contextLock),
  ].find((token) => transitionActive(token))

  return {
    ...session,
    folderId: root?.folderId,
    contextLock: lock,
    workspace: trail[0] ? folderWorkspace(trail[0]) : undefined,
  }
}

/** Follows sub-agent ancestry and retains every transition lock on that path. */
async function readSessionTrail(ctx: QueryCtx, session: Session) {
  const trail = [session]
  const seen = new Set([session._id])
  let current = session
  while (current.parent) {
    const parent = await ctx.db.get(current.parent.sessionId)
    if (!parent || parent.ownerId !== session.ownerId) error('Not found', 404)
    if (seen.has(parent._id)) error('Invalid session hierarchy', 409)
    seen.add(parent._id)
    trail.push(parent)
    current = parent
  }
  return trail
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
  const trail = await readFolderTrail(ctx, id, ownerId)
  if (trail.some((folder) => transitionActive(folder.contextLock)))
    error('Folder sources are being updated', 409)
  return { ...trail.at(-1)!, workspace: folderWorkspace(trail[0]!) }
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
