import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authQuery } from './functions'
import * as SessionCache from './model/session/cache'
import * as StreamLifecycle from './model/stream/lifecycle'
import * as StreamReads from './model/stream/reads'
import * as StreamSubagents from './model/stream/subagents'
import {
  saveSessionCacheArgsValidator,
  saveStreamMetaArgsValidator,
  scheduleStreamRetryArgsValidator,
} from './validators/args'

export const activeSessionIds = authQuery({
  args: {},
  handler: StreamReads.activeSessionIds,
})

export const _getContext = internalQuery({
  args: { streamId: v.id('streams') },
  handler: StreamReads._getContext,
})

export const _getProviderHistory = internalQuery({
  args: { streamId: v.id('streams') },
  handler: StreamReads._getProviderHistory,
})

export const _isActive = internalQuery({
  args: { streamId: v.id('streams') },
  handler: StreamReads._isActive,
})

export const _claim = internalMutation({
  args: { streamId: v.id('streams') },
  handler: StreamLifecycle._claim,
})

export const _patchMessage = internalMutation({
  args: { streamId: v.id('streams'), parts: v.array(v.any()) },
  handler: StreamLifecycle._patchMessage,
})

export const _continue = internalMutation({
  args: { streamId: v.id('streams') },
  handler: StreamLifecycle._continue,
})
export const _saveMeta = internalMutation({
  args: saveStreamMetaArgsValidator.fields,
  handler: StreamLifecycle._saveMeta,
})

export const _saveSessionCache = internalMutation({
  args: saveSessionCacheArgsValidator.fields,
  handler: SessionCache._save,
})

export const _complete = internalMutation({
  args: { streamId: v.id('streams') },
  handler: StreamLifecycle._complete,
})

export const _suspendStep = internalMutation({
  args: { streamId: v.id('streams') },
  handler: StreamSubagents._suspendStep,
})

export const _fail = internalMutation({
  args: { streamId: v.id('streams'), message: v.string() },
  handler: StreamLifecycle._fail,
})

export const _scheduleRetry = internalMutation({
  args: scheduleStreamRetryArgsValidator.fields,
  handler: StreamLifecycle._scheduleRetry,
})

export const _finalizeStopped = internalMutation({
  args: { streamId: v.id('streams') },
  handler: StreamLifecycle._finalizeStopped,
})

export const prune = internalMutation({
  args: {},
  handler: StreamLifecycle._prune,
})

export const _trackOffloadedOutput = internalMutation({
  args: {
    streamId: v.id('streams'),
    messageId: v.id('messages'),
    storageId: v.id('_storage'),
  },
  handler: StreamLifecycle._trackOffloadedOutput,
})

export const pruneOrphanedOutputs = internalMutation({
  args: {},
  handler: StreamLifecycle.pruneOrphanedOutputs,
})
