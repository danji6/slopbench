'use node'

import { v } from 'convex/values'

import { action, internalAction } from '../_generated/server'
import { createSessionArgsValidator } from '../validators/args'
import { sessionArchiveValidator } from '../validators/sub'
import * as Archive from './session/archive'
import * as SessionTitles from './session/title'
import * as Workspace from './session/workspace'

export const createWithWorkspace = action({
  args: createSessionArgsValidator.fields,
  handler: Workspace.createSession,
})

export const regenerateTitle = action({
  args: { sessionId: v.id('sessions') },
  handler: SessionTitles.regenerateTitle,
})

export const exportOne = action({
  args: { sessionId: v.id('sessions') },
  handler: Archive.exportOne,
})

export const importOne = action({
  args: { payload: sessionArchiveValidator },
  handler: Archive.importOne,
})

export const _generateTitle = internalAction({
  args: { sessionId: v.id('sessions') },
  handler: SessionTitles.generateTitle,
})
