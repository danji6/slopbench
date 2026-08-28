import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as SessionArchive from './model/session/archive'
import * as Sessions from './model/session/sessions'
import * as SessionState from './model/session/state'
import * as SessionTitles from './model/session/title'
import * as V from './validators/args'
import * as Sub from './validators/sub'

export const create = authMutation({
  args: {
    title: v.optional(v.string()),
    activeAgentId: v.optional(v.id('agents')),
    mode: v.optional(Sub.sessionModeValidator),
    approvalMode: v.optional(Sub.approvalModeValidator),
  },
  handler: Sessions.create,
})

export const duplicate = authMutation({
  args: { sessionId: v.id('sessions'), title: v.optional(v.string()) },
  handler: Sessions.duplicate,
})

export const list = authQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    showHidden: v.optional(v.boolean()),
  },
  handler: Sessions.list,
})

export const get = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Sessions.get,
})

export const getLogUrls = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Sessions.getLogUrls,
})

export const getState = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Sessions.getStateView,
})

export const update = authMutation({
  args: V.updateSessionArgsValidator.fields,
  handler: Sessions.update,
})

export const setModel = authMutation({
  args: {
    sessionId: v.id('sessions'),
    modelId: v.string(),
    reasoningEffort: v.string(),
  },
  handler: Sessions.setModel,
})

export const setReasoningEffort = authMutation({
  args: { sessionId: v.id('sessions'), reasoningEffort: v.string() },
  handler: Sessions.setReasoningEffort,
})

export const setMode = authMutation({
  args: { sessionId: v.id('sessions'), mode: Sub.sessionModeValidator },
  handler: Sessions.setMode,
})

export const setApprovalMode = authMutation({
  args: {
    sessionId: v.id('sessions'),
    mode: Sub.approvalModeValidator,
  },
  handler: Sessions.setApprovalMode,
})

export const setDisabled = authMutation({
  args: { sessionId: v.id('sessions'), disabled: v.boolean() },
  handler: Sessions.setDisabled,
})

export const setHidden = authMutation({
  args: { sessionId: v.id('sessions'), hidden: v.boolean() },
  handler: Sessions.setHidden,
})

export const remove = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Sessions.remove,
})

export const removeAll = authMutation({
  args: {},
  handler: Sessions.removeAll,
})

export const _exportOne = internalQuery({
  args: { sessionId: v.id('sessions'), subject: v.string() },
  handler: SessionArchive.exportOne,
})

export const _importOne = internalMutation({
  args: V.importSessionArgsValidator,
  handler: SessionArchive.importOne,
})

export const _getMode = internalQuery({
  args: { sessionId: v.id('sessions') },
  handler: (ctx, { sessionId }) => Sessions.getMode(ctx, sessionId),
})

export const _getApprovals = internalQuery({
  args: { sessionId: v.id('sessions') },
  handler: (ctx, { sessionId }) => SessionState.getApprovals(ctx, sessionId),
})

export const _getTitleContext = internalQuery({
  args: { sessionId: v.id('sessions') },
  handler: SessionTitles._getTitleContext,
})

export const _patchTitle = internalMutation({
  args: { sessionId: v.id('sessions'), title: v.string() },
  handler: SessionTitles._patchTitle,
})

export const _patchEnvironment = internalMutation({
  args: { sessionId: v.id('sessions'), environment: Sub.environmentValidator },
  handler: Sessions._patchEnvironment,
})

export const _getWorkspaceContext = internalQuery({
  args: { sessionId: v.id('sessions'), subject: v.string() },
  handler: Sessions._getWorkspaceContext,
})

export const _getMemberWorkspaceContext = internalQuery({
  args: { sessionId: v.id('sessions'), subject: v.string() },
  handler: Sessions._getMemberWorkspaceContext,
})

export const _patchWorkspace = internalMutation({
  args: {
    sessionId: v.id('sessions'),
    workspace: v.union(Sub.workspaceRefValidator, v.null()),
  },
  handler: Sessions._patchWorkspace,
})

export const _allowToolPaths = internalMutation({
  args: { sessionId: v.id('sessions'), paths: v.array(v.string()) },
  handler: Sessions._allowToolPaths,
})

export const _patchSessionLog = internalMutation({
  args: { sessionId: v.id('sessions'), storageId: v.id('_storage') },
  handler: Sessions._patchSessionLog,
})
