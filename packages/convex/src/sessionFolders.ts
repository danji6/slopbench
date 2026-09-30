import { v } from 'convex/values'

import { internalMutation } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Transitions from './model/session/folderTransitions'
import * as Folders from './model/session/folders'
import * as V from './validators/args'

export const list = authQuery({ args: {}, handler: Folders.list })

export const create = authMutation({
  args: { name: v.string(), icon: v.optional(v.string()) },
  handler: Folders.create,
})

export const rename = authMutation({
  args: V.folderRenameArgs.fields,
  handler: Folders.rename,
})

export const reorder = authMutation({
  args: { folderIds: v.array(v.id('sessionFolders')) },
  handler: Folders.reorder,
})

export const pin = authMutation({
  args: { sessionId: v.id('sessions'), pinned: v.boolean() },
  handler: Folders.pin,
})

export const _begin = internalMutation({
  args: V.folderTransitionArgs.fields,
  handler: Transitions.begin,
})

export const _finish = internalMutation({
  args: V.folderFinishArgs.fields,
  handler: Transitions.finish,
})

export const _createWithSources = internalMutation({
  args: V.folderCreateInternalArgs.fields,
  handler: Folders.createWithSources,
})
