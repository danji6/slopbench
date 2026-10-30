import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Changes from './model/changes'
import * as Chat from './model/chat'
import * as ChangesV from './validators/changes'
import * as V from './validators/messages'
import { environmentValidator } from './validators/sessions'
import {
  userShellFinishArgsValidator,
  userShellPatchArgsValidator,
} from './validators/shell'
import { activeStreamValidator } from './validators/streams'

export const messagesWindow = authQuery({
  args: V.messagesWindowArgsValidator.fields,
  handler: Chat.messagesWindow,
})

export const processingMessageSegments = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Chat.processingMessageSegments,
})

export const listFirstHumanMessage = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Chat.listFirstHumanMessage,
})

export const searchMessages = authQuery({
  args: {
    sessionId: v.id('sessions'),
    term: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: Chat.searchMessages,
})

export const sendMessage = authMutation({
  args: V.sendMessageArgsValidator.fields,
  handler: Chat.sendMessage,
})

export const invokeAgent = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Chat.invokeAgent,
})

export const resumeAgentMessage = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Chat.resumeAgentMessage,
})

export const getActiveStream = authQuery({
  args: { sessionId: v.id('sessions') },
  returns: v.union(v.null(), activeStreamValidator),
  handler: Chat.getActiveStream,
})

export const getToolOutputUrl = authQuery({
  args: { messageId: v.id('messages'), toolCallId: v.string() },
  handler: Chat.getToolOutputUrl,
})

export const stopStream = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Chat.stopStream,
})

export const retryStreamNow = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Chat.retryStreamNow,
})

export const resetSessionCache = authMutation({
  args: {
    sessionId: v.id('sessions'),
    requestId: v.optional(v.string()),
  },
  handler: Chat.resetSessionCache,
})

export const isCommandQueued = authQuery({
  args: {
    sessionId: v.id('sessions'),
    requestId: v.string(),
  },
  handler: Chat.isCommandQueued,
})

export const approveTool = authMutation({
  args: V.approveToolArgsValidator,
  handler: Chat.approveTool,
})

export const answerQuestions = authMutation({
  args: V.answerQuestionsArgsValidator,
  handler: Chat.answerQuestions,
})

export const compact = authMutation({
  args: {
    sessionId: v.id('sessions'),
    extraInstructions: v.optional(v.string()),
  },
  handler: Chat.compact,
})

export const timeout = authMutation({
  args: { sessionId: v.id('sessions'), duration: v.string() },
  handler: Chat.timeout,
})

export const autoCompact = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Chat.autoCompact,
})

export const impersonate = authMutation({
  args: {
    sessionId: v.id('sessions'),
    extraInstructions: v.optional(v.string()),
  },
  handler: Chat.impersonate,
})

export const editMessage = authMutation({
  args: { messageId: v.id('messages'), content: v.string() },
  handler: Chat.editMessage,
})

export const editMessagePart = authMutation({
  args: V.editMessagePartArgsValidator.fields,
  handler: Chat.editMessagePart,
})

export const deleteMessageParts = authMutation({
  args: V.deleteMessagePartsArgsValidator.fields,
  handler: Chat.deleteMessageParts,
})

export const deleteMessage = authMutation({
  args: { messageId: v.id('messages') },
  handler: Chat.deleteMessage,
})

export const deleteMessagesFrom = authMutation({
  args: { messageId: v.id('messages') },
  handler: Chat.deleteMessagesFrom,
})

export const retryMessage = authMutation({
  args: { messageId: v.id('messages') },
  handler: Chat.retryMessage,
})

export const selectMessageVersion = authMutation({
  args: { messageId: v.id('messages'), version: v.number() },
  handler: Chat.selectMessageVersion,
})

export const listMessageVersions = authQuery({
  args: { messageId: v.id('messages') },
  handler: Chat.listMessageVersions,
})

export const _drainCommandQueue = internalMutation({
  args: { sessionId: v.id('sessions') },
  handler: Chat.drainCommandQueue,
})

export const _runScheduledEvent = internalMutation({
  args: { eventId: v.id('scheduledEvents') },
  handler: Chat.runScheduledEvent,
})

export const _getMessageEvalContext = internalQuery({
  args: {
    messageId: v.id('messages'),
    invokerId: v.id('users'),
    version: v.number(),
    segmentIndex: v.number(),
  },
  handler: Chat._getMessageEvalContext,
})

export const _applyMessageEval = internalMutation({
  args: {
    messageId: v.id('messages'),
    version: v.number(),
    segmentIndex: v.number(),
    parts: v.array(v.any()),
    environment: environmentValidator,
    dirty: v.boolean(),
  },
  handler: Chat._applyMessageEval,
})

export const _beginUserShellWindow = internalMutation({
  args: { messageId: v.id('messages') },
  handler: Chat._beginUserShellWindow,
})

export const _patchUserShell = internalMutation({
  args: userShellPatchArgsValidator.fields,
  handler: Chat._patchUserShell,
})

export const _finishUserShell = internalMutation({
  args: userShellFinishArgsValidator.fields,
  handler: Chat._finishUserShell,
})

export const _reapUserShell = internalMutation({
  args: { messageId: v.id('messages') },
  handler: Chat._reapUserShell,
})

export const changeSummary = authQuery({
  args: { messageId: v.id('messages'), version: v.number() },
  handler: Changes.changeSummary,
})

export const changeDiff = authQuery({
  args: { changeSetId: v.id('changeSets'), fileKey: v.string() },
  handler: Changes.changeDiff,
})

export const restoreChanges = authMutation({
  args: ChangesV.restoreChangesArgsValidator.fields,
  handler: Changes.restoreChanges,
})

export const _prepareChanges = internalMutation({
  args: ChangesV.prepareChangesArgsValidator.fields,
  handler: Changes.prepareChanges,
})

export const _queueChanges = internalMutation({
  args: { streamId: v.id('streams'), generation: v.number() },
  handler: Changes.queueChanges,
})

export const _captureChangesIssue = internalMutation({
  args: { changeSetId: v.id('changeSets'), message: v.string() },
  handler: Changes.captureIssue,
})

export const _publishChanges = internalMutation({
  args: ChangesV.publishChangesArgsValidator.fields,
  handler: Changes.publishChanges,
})
export const _restoreChangesResult = internalMutation({
  args: ChangesV.restoreChangesResultValidator.fields,
  handler: Changes.restoreResult,
})

export const _getChangeSet = internalQuery({
  args: { changeSetId: v.id('changeSets') },
  handler: Changes.getChangeSet,
})

export const _changesFinishContext = internalQuery({
  args: { changeSetId: v.id('changeSets') },
  handler: Changes.finishContext,
})

export const _changesRestoreContext = internalQuery({
  args: { changeSetId: v.id('changeSets') },
  handler: Changes.restoreContext,
})

export const changeFiles = authQuery({
  args: {
    changeSetId: v.id('changeSets'),
    paginationOpts: paginationOptsValidator,
  },
  handler: Changes.changeFiles,
})

export const _reserveChangesPublication = internalMutation({
  args: ChangesV.reservePublicationArgsValidator.fields,
  handler: Changes.reservePublication,
})

export const _appendChanges = internalMutation({
  args: ChangesV.appendChangesArgsValidator.fields,
  handler: Changes.appendChanges,
})

export const _settleChangesCapture = internalMutation({
  args: { changeSetId: v.id('changeSets') },
  handler: Changes.settleCapture,
})

export const _releaseChangeGroup = internalMutation({
  args: { groupId: v.string() },
  handler: Changes.releaseChangeGroup,
})

export const _changeSetForStream = internalQuery({
  args: { streamId: v.id('streams') },
  handler: (ctx, args) => Changes.forStream(ctx, args.streamId),
})

export const _cleanupChanges = internalMutation({
  args: { sessionId: v.id('sessions') },
  handler: Changes.cleanupChanges,
})

export const _scheduleSettleChanges = internalMutation({
  args: { changeSetId: v.id('changeSets') },
  handler: Changes.scheduleSettleChanges,
})
