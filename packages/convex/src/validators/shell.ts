import { v } from 'convex/values'

/** Mirrors `ShellJobStatus` from `@sb/core/types/tools`. */
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

/** Mirrors `ShellToolOutput` from `@sb/core/types/tools`. */
export const shellToolOutputValidator = v.object({
  jobId: v.string(),
  status: shellJobStatusValidator,
  exitCode: v.union(v.number(), v.null()),
  text: v.string(),
  term: v.string(),
  termOffset: v.number(),
  waiting: v.optional(v.boolean()),
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

export const shellJobCarryArgsValidator = v.object({
  shellJobId: v.id('shellJobs'),
  term: v.string(),
  termOffset: v.number(),
})

export const shellJobReportArgsValidator = v.object({
  shellJobId: v.id('shellJobs'),
  output: v.optional(shellToolOutputValidator),
  errorText: v.optional(v.string()),
})

/**
 * A background shell job that runs long enough to outlive its tool call,
 * watched until it exits so its agent can be woken with the result.
 */
export const shellJobSchema = v.object({
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
