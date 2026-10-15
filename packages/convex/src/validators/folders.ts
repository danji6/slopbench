import { v } from 'convex/values'

import { folderSourceValidator } from './workspaces'

export const folderRenameArgs = v.object({
  folderId: v.id('sessionFolders'),
  name: v.string(),
  icon: v.optional(v.string()),
})

export const folderMoveArgs = v.object({
  folderId: v.id('sessionFolders'),
  parentId: v.union(v.id('sessionFolders'), v.null()),
  beforeFolderId: v.optional(v.id('sessionFolders')),
  confirmationKey: v.optional(v.string()),
})

const moveSessionCommand = v.object({
  kind: v.literal('move-session'),
  sessionId: v.id('sessions'),
  folderId: v.optional(v.id('sessionFolders')),
  unpin: v.optional(v.boolean()),
})

const moveFolderCommand = v.object({
  kind: v.literal('move-folder'),
  ...folderMoveArgs.fields,
})

const updateSourcesCommand = v.object({
  kind: v.literal('update-sources'),
  folderId: v.id('sessionFolders'),
  sources: v.array(folderSourceValidator),
})

const deleteFolderCommand = v.object({
  kind: v.literal('delete-folder'),
  folderId: v.id('sessionFolders'),
})

export const folderCommandValidator = v.union(
  moveSessionCommand,
  moveFolderCommand,
  updateSourcesCommand,
  deleteFolderCommand,
)

export const folderChangeArgs = v.object({ command: folderCommandValidator })

const workspaceSnapshot = {
  sourceWorkspaceKey: v.string(),
  targetWorkspaceKey: v.string(),
}

const folderSnapshot = { ...workspaceSnapshot, sourceRevision: v.number() }

export const folderCommitPlanValidator = v.union(
  v.object({
    ...moveSessionCommand.fields,
    ...workspaceSnapshot,
    targetRevision: v.union(v.number(), v.null()),
  }),
  v.object({ ...moveFolderCommand.fields, ...folderSnapshot }),
  v.object({ ...updateSourcesCommand.fields, ...folderSnapshot }),
  v.object({ ...deleteFolderCommand.fields, ...folderSnapshot }),
)

export const folderLockTargetValidator = v.union(
  v.object({ kind: v.literal('session'), id: v.id('sessions') }),
  v.object({ kind: v.literal('folder'), id: v.id('sessionFolders') }),
)

export const folderCreateBasicArgs = v.object({
  name: v.string(),
  icon: v.optional(v.string()),
  parentId: v.optional(v.id('sessionFolders')),
})

export const folderTransitionArgs = v.object({
  ...folderChangeArgs.fields,
  subject: v.string(),
  token: v.string(),
})

export const folderCreateArgs = v.object({
  ...folderCreateBasicArgs.fields,
  sources: v.array(folderSourceValidator),
})

export const folderCommitArgs = v.object({
  subject: v.string(),
  token: v.string(),
  plan: folderCommitPlanValidator,
})

export const folderCancelArgs = v.object({
  subject: v.string(),
  token: v.string(),
  target: folderLockTargetValidator,
})

export const folderCreateInternalArgs = v.object({
  ...folderCreateArgs.fields,
  subject: v.string(),
})

/** A session grouping and its ordered workspace sources. */
export const sessionFolderSchema = v.object({
  ownerId: v.id('users'),
  parentId: v.optional(v.id('sessionFolders')),
  name: v.string(),
  icon: v.optional(v.string()),
  position: v.number(),
  pinned: v.optional(v.boolean()),
  organizationRevision: v.optional(v.number()),
  sources: v.array(folderSourceValidator),
  revision: v.number(),
  contextLock: v.optional(v.string()),
})
