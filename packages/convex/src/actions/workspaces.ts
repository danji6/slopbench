'use node'

import { v } from 'convex/values'

import { internal } from '../_generated/api'
import { action, internalAction } from '../_generated/server'
import { getFlaggedPaths } from '../model/tool/shellTools'
import { settleChangesArgsValidator } from '../validators/changes'
import { workspaceRefValidator } from '../validators/workspaces'
import * as Workspace from './session/workspace'

export const listDirectories = action({
  args: { path: v.optional(v.string()), showHidden: v.optional(v.boolean()) },
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

export const _rememberFlaggedPaths = internalAction({
  args: {
    sessionId: v.id('sessions'),
    workspaceId: v.string(),
    workspace: v.optional(workspaceRefValidator),
    command: v.string(),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const flagged = await getFlaggedPaths(args.command, args, args.cwd)
    if (!flagged || flagged.length === 0) return
    await ctx.runMutation(internal.sessions._allowToolPaths, {
      sessionId: args.sessionId,
      paths: flagged,
    })
  },
})

export const _finishChanges = internalAction({
  args: { changeSetId: v.id('changeSets') },
  handler: async (ctx, args) =>
    (await import('./session/changes')).finishChanges(ctx, args),
})

export const _settleChanges = internalAction({
  args: settleChangesArgsValidator.fields,
  handler: async (ctx, args) =>
    (await import('./session/changes')).settleChanges(ctx, args),
})

export const _restoreChanges = internalAction({
  args: { changeSetId: v.id('changeSets'), operationId: v.string() },
  handler: async (ctx, args) =>
    (await import('./session/changes')).restoreChanges(ctx, args),
})

export const _removeChanges = internalAction({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) =>
    (await import('./session/changes')).removeChanges(ctx, args),
})

export const _finishChangesParticipant = internalAction({
  args: { changeSetId: v.id('changeSets'), participantId: v.string() },
  handler: async (ctx, args) =>
    (await import('./session/changes')).finishParticipantChanges(ctx, args),
})
