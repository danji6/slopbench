import { type ShellJobStatus } from './job-protocol'
import { type OutputRing } from './output-ring'
import { type ShellJobProcess } from './pty'
import { type ShellJobSubscriber } from './subscriber'

export type ShellJob = {
  jobId: string
  sessionId: string
  owner?: string
  messageId?: string
  messageCreatedAt?: number
  toolCallId?: string
  workspaceId: string
  command: string
  proc: ShellJobProcess
  ring: OutputRing
  status: ShellJobStatus
  endReason?: 'killed' | 'timeout'
  exitCode: number | null
  background: boolean
  allowInteractiveShells: boolean
  /** Job is waiting on terminal input (blocked stdin read or alt screen). */
  waiting: boolean
  stdinWait: boolean
  altScreen: boolean
  altCarry: string
  waitProbe?: ReturnType<typeof setInterval>
  startedAt: number
  exitedAt?: number
  /** Absent when the job runs without a timeout. */
  timeoutTimer?: ReturnType<typeof setTimeout>
  subscribers: Set<ShellJobSubscriber>
}
