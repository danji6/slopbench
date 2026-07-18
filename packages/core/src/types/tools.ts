import type * as V from '@sb/convex/validators'
import type { Infer } from 'convex/values'

export type RememberScope = Infer<typeof V.rememberScopeValidator>

export type ToolApprovals = Infer<typeof V.toolApprovalsValidator>

export type ApproveToolArgs<SessionId extends string = string> = {
  sessionId: SessionId
  toolCallId: string
  approved: boolean
  reason?: string
  remember?: RememberScope
  /** Note from the user, delivered to the agent alongside the response. */
  note?: string
}

export type ShellJobStatus =
  'running' | 'done' | 'killed' | 'timeout' | 'background' | 'lost'

export type ShellToolOutput = {
  jobId: string
  status: ShellJobStatus
  exitCode: number | null
  /** Full plain text output. Empty on preliminary updates. */
  text: string
  /** Raw output tail. May contain ANSI escapes. */
  term: string
  /** Index of term[0] in the job's full decoded output. */
  termOffset: number
  /**
   * True when the sidecar reports that the terminal is waiting for input.
   * Only meaningful while the job is running.
   */
  waiting?: boolean
}

export type ShellModelToolOutput = {
  type: 'text'
  value: string
}

/** Summary of a sidecar job, surfaced to the user for live monitoring/control. */
export type ShellJobSummary = {
  jobId: string
  command: string
  status: ShellJobStatus
  exitCode: number | null
  background: boolean
  waiting: boolean
  startedAt: number
  exitedAt?: number
}

/** Incremental output read from a running sidecar shell job. */
export type ShellJobPoll = {
  chunk: string
  nextOffset: number
  bufferStart: number
  status: ShellJobStatus
  exitCode: number | null
  background: boolean
  waiting: boolean
}
