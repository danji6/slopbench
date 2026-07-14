'use node'

import { v } from 'convex/values'

import { internal } from '../_generated/api'
import { action, internalAction } from '../_generated/server'
import { getFlaggedPaths } from '../model/tools'
import * as Workspace from './session/workspace'

export const listDirectories = action({
  args: { path: v.optional(v.string()) },
  handler: Workspace.listDirectories,
})

export const listFiles = action({
  args: { sessionId: v.id('sessions') },
  handler: Workspace.listWorkspaceFiles,
})

export const listFilesByRoot = action({
  args: { root: v.string() },
  handler: Workspace.listFilesByRoot,
})

export const resolveFileLinks = action({
  args: { sessionId: v.id('sessions'), paths: v.array(v.string()) },
  handler: Workspace.resolveFileLinks,
})

export const bind = action({
  args: {
    sessionId: v.id('sessions'),
    root: v.string(),
  },
  handler: Workspace.bindWorkspace,
})

export const clear = action({
  args: { sessionId: v.id('sessions') },
  handler: Workspace.clearWorkspace,
})

export const restoreCheckpoint = action({
  args: { sessionId: v.id('sessions') },
  handler: Workspace.restoreCheckpoint,
})

export const _rememberFlaggedPaths = internalAction({
  args: {
    sessionId: v.id('sessions'),
    workspaceId: v.string(),
    command: v.string(),
  },
  handler: async (ctx, args) => {
    const flagged = await getFlaggedPaths(args.command, args)
    if (!flagged || flagged.length === 0) return
    await ctx.runMutation(internal.sessions._allowToolPaths, {
      sessionId: args.sessionId,
      paths: flagged,
    })
  },
})
