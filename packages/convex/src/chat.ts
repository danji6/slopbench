import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Chat from './model/chat'
import * as V from './validators/args'

export const messagesWindow = authQuery({
  args: V.messagesWindowArgsValidator.fields,
  handler: Chat.messagesWindow,
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

export const resetPromptSnapshots = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Chat.resetPromptSnapshots,
})

export const approveTool = authMutation({
  args: V.approveToolArgsValidator,
  handler: Chat.approveTool,
})

export const compact = authMutation({
  args: {
    sessionId: v.id('sessions'),
    extraInstructions: v.optional(v.string()),
  },
  handler: Chat.compact,
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
    environment: v.any(),
    dirty: v.boolean(),
  },
  handler: Chat._applyMessageEval,
})
