import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authQuery } from './functions'
import { prepareSkillContext } from './model/skills/context'
import { prepareWorkspaceContext } from './model/stream/contextNotes'
import * as StreamLifecycle from './model/stream/lifecycle'
import * as StreamMeta from './model/stream/lifecycleMeta'
import * as StreamReads from './model/stream/reads'
import * as StreamSubagents from './model/stream/subagents'
import { filesystemToolContext } from './model/tool/filesystemContext'
import * as V from './validators/streams'
import {
  saveStreamMetaArgsValidator,
  scheduleStreamRetryArgsValidator,
} from './validators/streams'

export const activeSessionIds = authQuery({
  args: {},
  handler: StreamReads.activeSessionIds,
})

export const _getContext = internalQuery({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamReads._getContext,
})

export const _getProviderHistory = internalQuery({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamReads._getProviderHistory,
})

export const _hasActiveMedia = internalQuery({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamReads._hasActiveMedia,
})

export const _isActive = internalQuery({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamReads._isActive,
})

export const _claim = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamLifecycle._claim,
})

export const _patchMessage = internalMutation({
  args: V.patchStreamMessageArgsValidator.fields,
  handler: StreamLifecycle._patchMessage,
})

export const _continue = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamLifecycle._continue,
})

export const _recordStep = internalMutation({
  args: V.recordStreamStepArgsValidator.fields,
  handler: StreamLifecycle._recordStep,
})

export const _saveMeta = internalMutation({
  args: saveStreamMetaArgsValidator.fields,
  handler: StreamLifecycle._saveMeta,
})

export const _saveSessionCache = internalMutation({
  args: V.saveStreamCacheArgsValidator.fields,
  handler: StreamMeta.saveCache,
})

export const _complete = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamLifecycle._complete,
})

export const _getStopState = internalQuery({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamReads._getStopState,
})

export const _honorSoftStop = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamLifecycle._honorSoftStop,
})

export const _suspendStep = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamSubagents._suspendStep,
})

export const _fail = internalMutation({
  args: V.failStreamArgsValidator.fields,
  handler: StreamLifecycle._fail,
})

export const _scheduleRetry = internalMutation({
  args: scheduleStreamRetryArgsValidator.fields,
  handler: StreamLifecycle._scheduleRetry,
})

export const _omitActiveMedia = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamLifecycle._omitActiveMedia,
})

export const _handoff = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamLifecycle._handoff,
})

export const _heartbeat = internalMutation({
  args: V.streamExecutionArgsValidator.fields,
  handler: StreamLifecycle._heartbeat,
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
  args: V.trackStreamOutputArgsValidator.fields,
  handler: StreamLifecycle._trackOffloadedOutput,
})

export const pruneOrphanedOutputs = internalMutation({
  args: {},
  handler: StreamLifecycle.pruneOrphanedOutputs,
})

export const _saveEnvironment = internalMutation({
  args: V.saveStreamEnvironmentArgsValidator.fields,
  handler: StreamMeta.saveEnvironment,
})

export const _saveLog = internalMutation({
  args: V.saveStreamLogArgsValidator.fields,
  handler: StreamMeta.saveLog,
})

export const _prepareSkillContext = internalMutation({
  args: V.prepareContextNoteArgsValidator.fields,
  handler: prepareSkillContext,
})

export const _prepareWorkspaceContext = internalMutation({
  args: V.prepareContextNoteArgsValidator.fields,
  handler: prepareWorkspaceContext,
})

export const _getFilesystemContext = internalQuery({
  args: V.streamExecutionArgsValidator.fields,
  handler: filesystemToolContext,
})
