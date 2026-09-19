export type PtyMode = 'pty' | 'script' | 'pipe'

export type ShellJobStatus = 'running' | 'done' | 'killed' | 'timeout'

export type StartShellJobInput = {
  sessionId: string
  /** Whoever's stop terminates this job. */
  owner?: string
  /** Message (tool call) this job belongs to. */
  messageId?: string
  messageCreatedAt?: number
  toolCallId?: string
  workspaceId: string
  command: string
  cwd: string
  timeoutSeconds?: number
  background?: boolean
  cols?: number
  rows?: number
  shell?: string
  allowInteractiveShells?: boolean
}

export type ShellJobSummary = {
  jobId: string
  messageId?: string
  messageCreatedAt?: number
  toolCallId?: string
  command: string
  status: ShellJobStatus
  exitCode: number | null
  background: boolean
  waiting: boolean
  startedAt: number
  exitedAt?: number
  mode: PtyMode
}

export type PollResult = {
  chunk: string
  nextOffset: number
  bufferStart: number
  status: ShellJobStatus
  exitCode: number | null
  background: boolean
  waiting: boolean
}

export type ShellStreamEvent =
  | { type: 'chunk'; text: string; nextOffset: number }
  | { type: 'meta'; background: boolean; waiting: boolean }
  | { type: 'end'; status: ShellJobStatus; exitCode: number | null }
