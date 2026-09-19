import { type ShellStreamEvent } from '../sidecar'

export type ShellJobContext = {
  sessionId: string
  /** Session that owns this job's lifecycle. */
  owner?: string
  workspaceId: string
  shell?: string
  allowInteractiveShells?: boolean
  /** Tool call the job's terminal belongs to. */
  messageId?: string
  messageCreatedAt?: number
  toolCallId?: string
}

export type ShellJobInput = {
  command: string
  /** Display-only summary of what the command does. */
  description?: string
  timeout?: number
  run_in_background?: boolean
}

export type ShellOutputInput = {
  jobId: string
  wait_seconds?: number
}

export type PostSidecar = <T>(path: string, body: unknown) => Promise<T>

export type OpenStream = (
  path: string,
  query: Record<string, string>,
  signal?: AbortSignal,
) => AsyncGenerator<ShellStreamEvent>

export type ShellJobOptions = {
  abortSignal?: AbortSignal
  /**
   * Stops watching a job at this timestamp, yielding one last `running` output.
   * Lets a caller hand the job to another watcher before it runs out of time.
   */
  windowDeadline?: number
  /** Injectable for tests. */
  post?: PostSidecar
  openStream?: OpenStream
  pollIntervalMs?: number
  heartbeatMs?: number
}

/** Picks up a job another watcher left running, continuing its scrollback. */
export type ShellJobResume = {
  jobId: string
  term: string
  termOffset: number
}
