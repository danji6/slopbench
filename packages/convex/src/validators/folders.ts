import { v } from 'convex/values'

import { folderSourceValidator } from './workspaces'

export const folderRenameArgs = v.object({
  folderId: v.id('sessionFolders'),
  name: v.string(),
  icon: v.optional(v.string()),
})

export const folderChangeArgs = v.object({
  folderId: v.optional(v.id('sessionFolders')),
  sessionId: v.optional(v.id('sessions')),
  sources: v.optional(v.array(folderSourceValidator)),
  remove: v.optional(v.boolean()),
  unpin: v.optional(v.boolean()),
  parentId: v.optional(v.union(v.id('sessionFolders'), v.null())),
  beforeFolderId: v.optional(v.id('sessionFolders')),
  confirmationKey: v.optional(v.string()),
})

export const folderMoveArgs = v.object({
  folderId: v.id('sessionFolders'),
  parentId: v.union(v.id('sessionFolders'), v.null()),
  beforeFolderId: v.optional(v.id('sessionFolders')),
  confirmationKey: v.optional(v.string()),
})

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

export const folderFinishArgs = v.object({
  ...folderTransitionArgs.fields,
  commit: v.boolean(),
  targetRevision: v.optional(v.number()),
  targetWorkspaceKey: v.optional(v.string()),
  sourceWorkspaceKey: v.optional(v.string()),
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
  organizationRevision: v.optional(v.number()),
  sources: v.array(folderSourceValidator),
  revision: v.number(),
  contextLock: v.optional(v.string()),
})
