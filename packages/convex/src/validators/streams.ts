import { v } from 'convex/values'

import { tokenUsageValidator } from './providers'
import { sessionModeValidator } from './sessionModes'
import { saveSessionCacheArgsValidator } from './sessions'

export const streamStatusValidator = v.union(
  v.literal('pending'),
  v.literal('streaming'),
  v.literal('stopping'),
  v.literal('retrying'),
  v.literal('awaiting_approval'),
  v.literal('awaiting_input'),
)

/** Exposes chat controls without coupling clients to persisted execution data. */
export const activeStreamValidator = v.object({
  _id: v.id('streams'),
  invokedBy: v.id('users'),
  status: streamStatusValidator,
  attempt: v.number(),
  processingMessageId: v.optional(v.id('messages')),
  fireAt: v.optional(v.number()),
  retryAt: v.optional(v.number()),
  retryError: v.optional(v.string()),
})

export const streamCommandValidator = v.union(
  v.object({
    kind: v.literal('invoke'),
    mode: v.optional(sessionModeValidator),
  }),
  v.object({
    kind: v.literal('compact'),
    instructions: v.optional(v.string()),
    preserveContextBoundary: v.optional(v.boolean()),
    followUpAfterCompact: v.optional(v.boolean()),
    autoCompact: v.optional(v.boolean()),
  }),
  v.object({
    kind: v.literal('impersonate'),
    instructions: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('retry'),
    previousVersion: v.number(),
    mode: v.optional(sessionModeValidator),
  }),
)

const optionalOutput = {
  processingMessageId: v.optional(v.id('messages')),
  processingContentId: v.optional(v.id('messageContents')),
}
const requiredOutput = {
  processingMessageId: v.id('messages'),
  processingContentId: v.optional(v.id('messageContents')),
}

/** Stores only the data owned by the current lifecycle phase. */
export const streamStateValidator = v.union(
  v.object({ phase: v.literal('reserved'), ...optionalOutput }),
  v.object({
    phase: v.literal('pending'),
    jobId: v.id('_scheduled_functions'),
    fireAt: v.optional(v.number()),
    ...optionalOutput,
  }),
  v.object({ phase: v.literal('streaming'), ...requiredOutput }),
  v.object({
    phase: v.literal('retrying'),
    jobId: v.id('_scheduled_functions'),
    retryAt: v.number(),
    retryError: v.string(),
    ...requiredOutput,
  }),
  v.object({ phase: v.literal('awaiting_approval'), ...requiredOutput }),
  v.object({ phase: v.literal('awaiting_input'), ...requiredOutput }),
  v.object({
    phase: v.literal('stopping'),
    retryError: v.optional(v.string()),
    ...optionalOutput,
  }),
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
  command: streamCommandValidator,
  state: streamStateValidator,
  contextBoundaryMessageId: v.optional(v.id('messages')),
  contextBoundaryCreationTime: v.optional(v.number()),
  attempt: v.number(),
  leaseExpiresAt: v.number(),
  /** A stop to honor after the current provider step. */
  stopAt: v.optional(v.number()),
  /** Retry this logical turn without automatically materializing media. */
  omitActiveMedia: v.optional(v.boolean()),
  skillContextPrepared: v.optional(v.boolean()),
  skillIntegrationFingerprint: v.optional(v.string()),
  skillContextMessageId: v.optional(v.id('messages')),
  workspaceContextPrepared: v.optional(v.boolean()),
  workspaceContextMessageId: v.optional(v.id('messages')),
  mcpContextFingerprint: v.optional(v.string()),
  mcpContextMessageId: v.optional(v.id('messages')),
  suppressFollowUp: v.optional(v.boolean()),
  /** True for child (sub-agent) streams stopped from above. */
  suppressReport: v.optional(v.boolean()),
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

export const prepareContextNoteArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  fingerprint: v.string(),
  content: v.string(),
  label: v.optional(v.string()),
  integrationFingerprint: v.optional(v.string()),
})
