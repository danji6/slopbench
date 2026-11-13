import { v } from 'convex/values'

/** Mirrors `ShellJobStatus` from `@cv/core/types/tools`. */
export const shellJobStatusValidator = v.union(
  v.literal('running'),
  v.literal('done'),
  v.literal('killed'),
  v.literal('timeout'),
  v.literal('background'),
  v.literal('lost'),
)

export const terminalWriteArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
  data: v.string(),
})

export const terminalKillArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
})

export const terminalResizeArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
  cols: v.number(),
  rows: v.number(),
})

export const terminalSessionArgsValidator = v.object({
  sessionId: v.id('sessions'),
})

export const terminalPollArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
  offset: v.number(),
})

export const shellOutputSpanValidator = v.object({
  start: v.number(),
  end: v.number(),
})

export const shellOutputRangeValidator = v.object({
  requestedOffset: v.number(),
  startOffset: v.number(),
  nextOffset: v.number(),
  bufferEnd: v.number(),
  hasMore: v.boolean(),
  replay: v.boolean(),
  unavailable: v.array(shellOutputSpanValidator),
  ansiState: v.union(
    v.literal('text'),
    v.literal('escape'),
    v.literal('charset'),
    v.literal('csi'),
    v.literal('osc'),
    v.literal('oscEscape'),
  ),
})

/** Mirrors `ShellToolOutput` from `@cv/core/types/tools`. */
export const shellToolOutputValidator = v.object({
  jobId: v.string(),
  status: shellJobStatusValidator,
  exitCode: v.union(v.number(), v.null()),
  text: v.string(),
  term: v.string(),
  termOffset: v.number(),
  waiting: v.optional(v.boolean()),
  range: v.optional(shellOutputRangeValidator),
})

export const shellDeliveryPositionArgsValidator = v.object({
  streamId: v.id('streams'),
  generation: v.number(),
  jobId: v.string(),
  offset: v.optional(v.number()),
})

export const shellOutputDeliverySchema = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  workspaceId: v.string(),
  jobId: v.string(),
  messageId: v.id('messages'),
  version: v.number(),
  partId: v.string(),
  range: shellOutputRangeValidator,
})

export const userShellPatchArgsValidator = v.object({
  messageId: v.id('messages'),
  toolCallId: v.string(),
  output: shellToolOutputValidator,
})

export const userShellFinishArgsValidator = v.object({
  messageId: v.id('messages'),
  toolCallId: v.string(),
  invokedBy: v.id('users'),
  silent: v.boolean(),
  duration: v.number(),
  output: v.optional(shellToolOutputValidator),
  errorText: v.optional(v.string()),
})

export const shellJobRegisterArgsValidator = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  invokedBy: v.id('users'),
  jobId: v.string(),
  command: v.string(),
  toolCallId: v.string(),
})

export const shellJobUserKillArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
})

export const shellJobSessionArgsValidator = v.object({
  sessionId: v.id('sessions'),
})

export const shellJobExecutionArgsValidator = v.object({
  shellJobId: v.id('shellJobs'),
  generation: v.number(),
})

export const shellJobCarryArgsValidator = v.object({
  ...shellJobExecutionArgsValidator.fields,
  term: v.string(),
  termOffset: v.number(),
})

export const shellJobReportArgsValidator = v.object({
  ...shellJobExecutionArgsValidator.fields,
  output: v.optional(shellToolOutputValidator),
  errorText: v.optional(v.string()),
})

/**
 * A background shell job that runs long enough to outlive its tool call,
 * watched until it exits so its agent can be woken with the result.
 */
export const shellJobSchema = v.object({
  generation: v.number(),
  /** Session that owns the turn. The report is delivered here. */
  sessionId: v.id('sessions'),
  /** Agent that started it, and the report's sender. */
  agentId: v.id('agents'),
  invokedBy: v.id('users'),
  /** Sidecar job id. */
  jobId: v.string(),
  command: v.string(),
  toolCallId: v.string(),
  startedAt: v.number(),
  /** Refreshed each watcher window. A stale value means nobody is watching. */
  heartbeatAt: v.number(),
  /** Scrollback carried across windows to keep the reader's offsets continuous. */
  term: v.string(),
  termOffset: v.number(),
  /** Whether a user stopped this job. Manual stops don't wake the agent. */
  userKilled: v.optional(v.boolean()),
  /** The running watcher, cancelled on release. */
  watcherId: v.optional(v.id('_scheduled_functions')),
})
