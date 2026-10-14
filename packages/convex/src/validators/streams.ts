import { v } from 'convex/values'

import { tokenUsageValidator } from './providers'
import { sessionModeValidator } from './sessionModes'
import { saveSessionCacheArgsValidator } from './sessions'

export const streamErrorValidator = v.object({
  kind: v.union(v.literal('rate-limit'), v.literal('error')),
  message: v.string(),
})

export const streamStatusValidator = v.union(
  v.literal('pending'),
  v.literal('streaming'),
  v.literal('stopping'),
  v.literal('retrying'),
  v.literal('awaiting_approval'),
  v.literal('awaiting_input'),
  v.literal('failed'),
)

export const streamValidator = v.object({
  requestId: v.string(),
  status: streamStatusValidator,
  attempt: v.number(),
  jobId: v.optional(v.id('_scheduled_functions')),
  retryAt: v.optional(v.number()),
  error: v.optional(streamErrorValidator),
  messageType: v.optional(v.string()),
  promptMessageId: v.optional(v.string()),
})

export const streamOperationValidator = v.union(
  v.literal('invoke'),
  v.literal('compact'),
  v.literal('impersonate'),
  v.literal('retry'),
)

export const streamExecutionArgsValidator = v.object({
  streamId: v.id('streams'),
  generation: v.number(),
})

export const patchStreamMessageArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  parts: v.array(v.any()),
})

export const recordStreamStepArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  interruptible: v.boolean(),
})

export const failStreamArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  message: v.string(),
})

export const trackStreamOutputArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  messageId: v.id('messages'),
  storageId: v.id('_storage'),
})

export const saveStreamMetaArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  duration: v.number(),
  toolErrors: v.array(v.string()),
  warnings: v.array(v.string()),
  usage: tokenUsageValidator,
})

export const scheduleStreamRetryArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  retryAt: v.number(),
  retryError: v.string(),
})

/** A leased background turn, including retries and deferred work. */
export const streamSchema = v.object({
  generation: v.number(),
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  invokedBy: v.id('users'),
  processingMessageId: v.optional(v.id('messages')),
  /** The active segment row. */
  processingContentId: v.optional(v.id('messageContents')),
  /** The selected version to restore if Retry is stopped before output. */
  retryPreviousVersion: v.optional(v.number()),
  contextBoundaryMessageId: v.optional(v.id('messages')),
  contextBoundaryCreationTime: v.optional(v.number()),
  operation: streamOperationValidator,
  mode: v.optional(sessionModeValidator),
  blocking: v.boolean(),
  status: streamStatusValidator,
  attempt: v.number(),
  leaseExpiresAt: v.number(),
  jobId: v.optional(v.id('_scheduled_functions')),
  /** When a pending stream should claim. */
  fireAt: v.optional(v.number()),
  /** A stop to honor after the current provider step. */
  stopAt: v.optional(v.number()),
  retryAt: v.optional(v.number()),
  retryError: v.optional(v.string()),
  /** Preserve the reservation's boundary instead of refreshing it on claim. */
  preserveContextBoundary: v.optional(v.boolean()),
  /** Resume a deferred invoke only after this compaction succeeds. */
  followUpAfterCompact: v.optional(v.boolean()),
  /** This compaction was scheduled by /autoCompact and gets bounded retries. */
  autoCompact: v.optional(v.boolean()),
  /** Retry this logical turn without automatically materializing media. */
  omitActiveMedia: v.optional(v.boolean()),
  suppressFollowUp: v.optional(v.boolean()),
  /** True for child (sub-agent) streams stopped from above. */
  suppressReport: v.optional(v.boolean()),
  instructions: v.optional(v.string()),
})

export const saveStreamCacheArgsValidator = v.object({
  ...saveSessionCacheArgsValidator.fields,
  ...streamExecutionArgsValidator.fields,
})

export const saveStreamEnvironmentArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  environment: v.record(v.string(), v.any()),
})

export const saveStreamLogArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  storageId: v.id('_storage'),
})
